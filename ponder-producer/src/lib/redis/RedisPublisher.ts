import Redis from "ioredis";

/**
 * Interface for the blockchain message format
 */
export interface BlockchainMessage {
  transaction: {
    hash: string;
    blockNumber: number;
    chainId: number;
    chainName: string;
    from: string;
    to?: string;
    value: string;
    gasUsed?: string;
    gasPrice?: string;
    status?: string;
    logs?: any[];
    timestamp: number;
    blockHash: string;
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
 * Redis connection options
 */
export interface RedisConnectionOptions {
  password?: string;
  database?: number;
  username?: string;
  tls?: boolean;
  retryDelayOnFailover?: number;
  enableReadyCheck?: boolean;
  maxRetriesPerRequest?: number;
}

/**
 * Redis publisher status
 */
export interface RedisPublisherStatus {
  isConnected: boolean;
  messagesPublished: number;
  lastMessageTimestamp: number | null;
  errors: number;
  retries: number;
}

/**
 * Interface for the Redis publisher
 */
export interface RedisPublisher {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publishMessage(message: BlockchainMessage): Promise<boolean>;
  publishMessages(messages: BlockchainMessage[]): Promise<boolean>;
  isConnected(): boolean;
  getStatus(): RedisPublisherStatus;
}

/**
 * Implementation of the Redis publisher
 */
export class RedisPublisherImpl implements RedisPublisher {
  private client: Redis;
  private channel: string;
  private connected: boolean = false;
  private messagesPublished: number = 0;
  private lastMessageTimestamp: number | null = null;
  private errorCount: number = 0;
  private retryCount: number = 0;

  /**
   * Constructor for the Redis publisher
   * @param host Redis host
   * @param port Redis port
   * @param channel Redis channel to publish to
   * @param options Redis connection options
   */
  constructor(
    host: string,
    port: number,
    channel: string,
    options?: RedisConnectionOptions
  ) {
    this.channel = channel;
    this.client = new Redis({
      host,
      port,
      password: options?.password,
      db: options?.database,
      username: options?.username,
      tls: options?.tls ? {} : undefined,
      retryStrategy: (times) => {
        this.retryCount++;
        const delay = options?.retryDelayOnFailover || 1000;
        return Math.min(times * delay, 30000);
      },
      enableReadyCheck: options?.enableReadyCheck,
      maxRetriesPerRequest: options?.maxRetriesPerRequest,
    });

    this.client.on("error", (err) => {
      this.errorCount++;
      this.connected = false;
      console.error("Redis client error:", err);
    });

    this.client.on("ready", () => {
      this.connected = true;
      console.log("Redis client ready");
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.connected) {
      try {
        if (
          this.client.status === "connecting" ||
          this.client.status === "connect"
        ) {
          this.connected = true;
          console.log("Redis connection already in progress");
          return;
        }

        if (this.client.status !== "ready") {
          await this.client.connect();
        }

        this.connected = true;
        console.log("Connected to Redis");
      } catch (error) {
        this.errorCount++;
        console.error("Failed to connect to Redis:", error);
        throw error;
      }
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      try {
        await this.client.quit();
        this.connected = false;
        console.log("Disconnected from Redis");
      } catch (error) {
        this.errorCount++;
        console.error("Failed to disconnect from Redis:", error);
        throw error;
      }
    }
  }

  /**
   * Publish a message to Redis
   * @param message Blockchain message to publish
   * @returns Promise resolving to true if successful
   */
  async publishMessage(message: BlockchainMessage): Promise<boolean> {
    if (!this.connected) {
      throw new Error("Not connected to Redis");
    }

    try {
      const result = await this.client.publish(
        this.channel,
        JSON.stringify(message, (_, value) =>
          typeof value === "bigint" ? value.toString() : value
        )
      );
      this.messagesPublished++;
      this.lastMessageTimestamp = Date.now();
      return result > 0;
    } catch (error) {
      this.errorCount++;
      console.error("Failed to publish message:", error);
      throw error;
    }
  }

  /**
   * Publish multiple messages to Redis, ordered by timestamp
   * @param messages Array of blockchain messages to publish
   * @returns Promise resolving to true if successful
   */
  async publishMessages(messages: BlockchainMessage[]): Promise<boolean> {
    if (!this.connected) {
      throw new Error("Not connected to Redis");
    }

    // Sort messages by timestamp (earliest first)
    const sortedMessages = [...messages].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    try {
      const pipeline = this.client.pipeline();

      for (const message of sortedMessages) {
        pipeline.publish(
          this.channel,
          JSON.stringify(message, (_, value) =>
            typeof value === "bigint" ? value.toString() : value
          )
        );
      }

      const results = await pipeline.exec();
      if (!results) {
        return false;
      }

      this.messagesPublished += sortedMessages.length;
      this.lastMessageTimestamp = Date.now();

      return true;
    } catch (error) {
      this.errorCount++;
      console.error("Failed to publish messages:", error);
      throw error;
    }
  }

  /**
   * Check if connected to Redis
   * @returns True if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the status of the publisher
   * @returns Status object
   */
  getStatus(): RedisPublisherStatus {
    return {
      isConnected: this.connected,
      messagesPublished: this.messagesPublished,
      lastMessageTimestamp: this.lastMessageTimestamp,
      errors: this.errorCount,
      retries: this.retryCount,
    };
  }
}
