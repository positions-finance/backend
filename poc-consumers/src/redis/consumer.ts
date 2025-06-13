import { createClient, RedisClientType } from "redis";
import { Repository } from "typeorm";
import env from "@/config/env";
import logger from "@/utils/logger";
import { ProcessedTransaction } from "@/models/ProcessedTransaction";
import { AppDataSource } from "@/database/data-source";
import { NftTransferService } from "@/services/NftTransferService";
import { VaultEventService } from "@/services/VaultEventService";
import { RelayerService } from "@/services/RelayerService";
import { IConsumerService } from "@/interfaces/consumer.interface";

/**
 * Interface for the enhanced transaction message received from Redis
 * Based on the migration guide's enhanced message structure
 */
interface BlockchainMessage {
  transaction: {
    hash: string;
    blockNumber: number;
    chainId: number;
    chainName: string;
    from: string;
    to?: string;
    value: string;
    gasUsed: string;
    gasPrice: string;
    status: string;
    logs?: any[];
    timestamp: number;
    blockHash?: string;
    data?: string;
    topics?: string[];
  };
  events: any[];
  timestamp: number;
  metadata: {
    chainId: number;
    chainName: string;
    blockNumber: number;
    transactionHash: string;
    timestamp: number;
  };
}

/**
 * Legacy interface for backward compatibility with existing message format
 */
interface TransactionMessage {
  transaction: {
    blockHash: string;
    blockNumber: number;
    hash: string;
    from: string;
    to?: string;
    value: string;
    data: string;
    chainId: number;
    chainName: string;
    topics: string[];
    logs?: any[];
  };
  timestamp: number;
  topics: string[];
}

export class RedisConsumerService implements IConsumerService {
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private isRunning: boolean = false;
  private transactionRepository: Repository<ProcessedTransaction>;
  private nftTransferService: NftTransferService;
  private vaultEventService: VaultEventService;
  private relayerService: RelayerService;
  private connectionTimeout: number = 10000; // 10 seconds timeout

  constructor() {
    const redisConfig: any = {
      socket: {
        host: env.REDIS.HOST,
        port: env.REDIS.PORT,
        connectTimeout: this.connectionTimeout,
        commandTimeout: 5000,
        reconnectStrategy: (retries: number) => {
          if (retries > 3) {
            logger.error("Redis connection failed after 3 retries, giving up");
            return false;
          }
          logger.warn(
            `Redis connection retry ${retries}, waiting ${Math.min(
              retries * 1000,
              3000
            )}ms`
          );
          return Math.min(retries * 1000, 3000);
        },
      },
      database: env.REDIS.DATABASE || 0,
    };

    if (env.REDIS.TLS) {
      redisConfig.socket.tls = true;
    }

    const password = env.REDIS.PASSWORD;
    const username = env.REDIS.USERNAME;

    if (
      password &&
      password.trim() !== "" &&
      password !== "your-redis-password" &&
      password !== "placeholder" &&
      password !== "undefined" &&
      password !== "null"
    ) {
      redisConfig.password = password;
      logger.info("Redis authentication enabled with password");
    } else {
      logger.info(
        "Redis authentication disabled - connecting without password (suitable for AWS ElastiCache)"
      );
    }

    if (
      username &&
      username.trim() !== "" &&
      username !== "your-redis-username" &&
      username !== "placeholder" &&
      username !== "undefined" &&
      username !== "null"
    ) {
      redisConfig.username = username;
      logger.info("Redis authentication enabled with username");
    }

    this.client = createClient(redisConfig);
    this.subscriber = this.client.duplicate();

    this.transactionRepository =
      AppDataSource.getRepository(ProcessedTransaction);
    this.nftTransferService = new NftTransferService(true);
    this.vaultEventService = new VaultEventService();
    this.relayerService = new RelayerService();

    this.client.on("error", (err) => {
      logger.error("Redis client error:", err);
    });

    this.subscriber.on("error", (err) => {
      logger.error("Redis subscriber error:", err);
    });

    this.client.on("connect", () => {
      logger.info("Redis client connected");
    });

    this.subscriber.on("connect", () => {
      logger.info("Redis subscriber connected");
    });

    this.client.on("ready", () => {
      logger.info("Redis client ready");
    });

    this.subscriber.on("ready", () => {
      logger.info("Redis subscriber ready");
    });
  }

  /**
   * Connect to Redis and start consuming messages with timeout
   */
  async start(): Promise<void> {
    try {
      logger.info(
        `Attempting to connect to Redis at ${env.REDIS.HOST}:${env.REDIS.PORT}`
      );

      // Add timeout wrapper for Redis connections
      const connectWithTimeout = async (
        client: RedisClientType,
        name: string
      ): Promise<void> => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(
              new Error(
                `${name} connection timeout after ${this.connectionTimeout}ms`
              )
            );
          }, this.connectionTimeout);

          client
            .connect()
            .then(() => {
              clearTimeout(timeout);
              resolve();
            })
            .catch((error) => {
              clearTimeout(timeout);
              reject(error);
            });
        });
      };

      // Connect with timeout
      await connectWithTimeout(this.client, "Redis client");
      await connectWithTimeout(this.subscriber, "Redis subscriber");

      this.isRunning = true;
      logger.info("Connected to Redis successfully");

      // Subscribe to the designated channel
      await this.subscriber.subscribe(env.REDIS.CHANNEL, (message) => {
        this.processMessage(message).catch((error) => {
          logger.error("Error processing Redis message:", error);
        });
      });

      logger.info(`Subscribed to Redis channel: ${env.REDIS.CHANNEL}`);

      // Note: Removed timer-based Merkle generation since we now use immediate generation
      logger.info(
        "NFT Transfer service configured for immediate Merkle generation"
      );
    } catch (error) {
      logger.error("Failed to start Redis consumer:", error);
      // Don't throw the error, just log it and continue
      // This allows the application to start even if Redis is not available
      logger.warn("Application will continue without Redis consumer");
      this.isRunning = false;
    }
  }

  /**
   * Schedule Merkle root generation (DEPRECATED - now using immediate generation)
   * Kept for backward compatibility but no longer scheduling
   */
  private scheduleMerkleRootGeneration(): void {
    logger.info(
      "Timer-based Merkle generation is disabled - using immediate generation instead"
    );
  }

  /**
   * Process an incoming Redis message
   */
  private async processMessage(message: string): Promise<void> {
    if (!message) {
      logger.warn("Received empty message, skipping");
      return;
    }

    try {
      const data = JSON.parse(message);

      const transactionData = this.normalizeMessage(data);

      logger.info("Received transaction message", {
        transactionHash: transactionData.transaction.hash,
        chainName: transactionData.transaction.chainName,
        blockNumber: transactionData.transaction.blockNumber,
      });

      await Promise.all([
        this.processNftTransfers(transactionData),
        this.processVaultEvents(transactionData),
        this.processRelayerEvents(transactionData),
      ]);

      await this.storeTransaction(transactionData);
    } catch (error) {
      logger.error("Failed to process message:", error);
    }
  }

  /**
   * Normalize message format to handle both enhanced and legacy formats
   */
  private normalizeMessage(data: any): TransactionMessage {
    // Check if it's the new enhanced format
    if (data.metadata && data.transaction && data.events !== undefined) {
      const blockchainMessage = data as BlockchainMessage;

      // Convert enhanced format to legacy format for backward compatibility
      return {
        transaction: {
          blockHash: blockchainMessage.transaction.blockHash || "",
          blockNumber: blockchainMessage.transaction.blockNumber,
          hash: blockchainMessage.transaction.hash,
          from: blockchainMessage.transaction.from,
          to: blockchainMessage.transaction.to,
          value: blockchainMessage.transaction.value,
          data: blockchainMessage.transaction.data || "",
          chainId: blockchainMessage.transaction.chainId,
          chainName: blockchainMessage.transaction.chainName,
          topics: blockchainMessage.transaction.topics || [],
          logs: blockchainMessage.transaction.logs || [],
        },
        timestamp: blockchainMessage.timestamp,
        topics: blockchainMessage.transaction.topics || [],
      };
    }

    // Return as-is if it's already in legacy format
    return data as TransactionMessage;
  }

  /**
   * Process transaction for NFT transfers
   */
  private async processNftTransfers(data: TransactionMessage): Promise<void> {
    try {
      await this.nftTransferService.processTransaction(data.transaction);
    } catch (error) {
      logger.error("Failed to process NFT transfers:", error);
    }
  }

  /**
   * Process transaction for vault events
   */
  private async processVaultEvents(data: TransactionMessage): Promise<void> {
    try {
      await this.vaultEventService.processTransaction(data.transaction);
    } catch (error) {
      logger.error("Failed to process vault events:", error);
    }
  }

  /**
   * Process transaction for relayer events
   */
  private async processRelayerEvents(data: TransactionMessage): Promise<void> {
    try {
      await this.relayerService.processTransaction(data.transaction);
    } catch (error) {
      logger.error("Failed to process relayer events:", error);
    }
  }

  /**
   * Store a transaction in the database
   */
  private async storeTransaction(data: TransactionMessage): Promise<void> {
    try {
      const existing = await this.transactionRepository.findOne({
        where: { transactionHash: data.transaction.hash },
      });

      if (existing) {
        logger.debug("Transaction already processed, skipping", {
          transactionHash: data.transaction.hash,
          chainName: data.transaction.chainName,
        });
        return;
      }

      const transaction = new ProcessedTransaction();
      transaction.chainId = data.transaction.chainId;
      transaction.chainName = data.transaction.chainName;
      transaction.transactionHash = data.transaction.hash;
      transaction.blockNumber = data.transaction.blockNumber;
      transaction.blockHash = data.transaction.blockHash;
      transaction.senderAddress = data.transaction.from.toLowerCase();
      transaction.receiverAddress = (data.transaction.to || "").toLowerCase();
      transaction.transactionValue = data.transaction.value;
      transaction.transactionData = data.transaction.data;
      transaction.matchedTopics = data.topics;
      transaction.transactionTimestamp = data.timestamp;
      transaction.transactionDetails = data.transaction;
      transaction.processingStatus = "processed";

      await this.transactionRepository.save(transaction);

      logger.info("Transaction processed and stored", {
        transactionHash: data.transaction.hash,
        chainId: data.transaction.chainId,
        chainName: data.transaction.chainName,
      });
    } catch (error) {
      logger.error("Failed to store transaction:", error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async stop(): Promise<void> {
    try {
      if (!this.isRunning) {
        logger.info("Redis consumer is not running");
        return;
      }

      await this.subscriber.unsubscribe(env.REDIS.CHANNEL);
      await this.subscriber.disconnect();
      await this.client.disconnect();

      this.isRunning = false;
      logger.info("Redis consumer stopped successfully");
    } catch (error) {
      logger.error("Failed to stop Redis consumer:", error);
      throw error;
    }
  }

  /**
   * Pause the consumer (Redis doesn't have native pause/resume, so we unsubscribe)
   */
  async pause(): Promise<void> {
    try {
      if (!this.isRunning) {
        logger.info("Redis consumer is not running");
        return;
      }

      await this.subscriber.unsubscribe(env.REDIS.CHANNEL);
      logger.info("Redis consumer paused (unsubscribed from channel)");
    } catch (error) {
      logger.error("Failed to pause Redis consumer:", error);
      throw error;
    }
  }

  /**
   * Resume the consumer (resubscribe to channel)
   */
  async resume(): Promise<void> {
    try {
      if (!this.isRunning) {
        logger.info("Redis consumer is not running");
        return;
      }

      await this.subscriber.subscribe(env.REDIS.CHANNEL, (message) => {
        this.processMessage(message).catch((error) => {
          logger.error("Error processing Redis message:", error);
        });
      });

      logger.info("Redis consumer resumed (resubscribed to channel)");
    } catch (error) {
      logger.error("Failed to resume Redis consumer:", error);
      throw error;
    }
  }

  /**
   * Get the consumer status
   */
  getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }

  /**
   * Manually trigger Merkle root generation and submission
   */
  async triggerMerkleRootGeneration(): Promise<string> {
    logger.info("Manually triggering Merkle root generation");
    await this.nftTransferService.processAndSubmitMerkleRoot();
    return "Merkle root generation triggered";
  }

  /**
   * Get Redis connection info for monitoring
   */
  async getConnectionInfo(): Promise<any> {
    try {
      const info = await this.client.info();
      return {
        host: env.REDIS.HOST,
        port: env.REDIS.PORT,
        database: env.REDIS.DATABASE,
        channel: env.REDIS.CHANNEL,
        connected: this.client.isOpen,
        subscriberConnected: this.subscriber.isOpen,
        isRunning: this.isRunning,
        info: info,
      };
    } catch (error) {
      logger.error("Failed to get Redis connection info:", error);
      throw error;
    }
  }

  /**
   * Check channel subscription status
   */
  async getChannelInfo(): Promise<any> {
    try {
      // Use PUBSUB commands directly with sendCommand
      const channels = await this.client.sendCommand(["PUBSUB", "CHANNELS"]);
      const numSubResult = await this.client.sendCommand([
        "PUBSUB",
        "NUMSUB",
        env.REDIS.CHANNEL,
      ]);

      // Parse NUMSUB result (returns array like [channel, count])
      const subscriberCount =
        Array.isArray(numSubResult) && numSubResult.length > 1
          ? parseInt(numSubResult[1] as string, 10)
          : 0;

      return {
        allChannels: channels,
        currentChannel: env.REDIS.CHANNEL,
        subscriberCount: subscriberCount,
      };
    } catch (error) {
      logger.error("Failed to get channel info:", error);
      throw error;
    }
  }
}
