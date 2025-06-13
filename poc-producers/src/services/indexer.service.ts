import {
  BlockchainProvider,
  BlockchainMessage,
  TopicFilter,
  IndexerStatus,
} from "../utils/types/blockchain.types";
import { RedisPublisher } from "../utils/types/redis.types";
import BlockchainEventsProcessor from "./events.service";
import { UnprocessedBlocksService } from "./unprocessed-blocks.service";
import { ProcessedBlocksService } from "./processed-blocks.service";
import logger from "../utils/logger";
import config from "../config/env";
import { BlockchainIndexer } from "../utils/types/indexer.types";

/**
 * Implementation of the blockchain indexer
 * Handles indexing blocks from a blockchain and publishing messages to Redis
 */
export default class BlockchainIndexerImpl implements BlockchainIndexer {
  private topicFilters: TopicFilter[] = [];
  private latestBlock: number = 0;
  private processedBlock: number = 0;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private retryDelay: number;
  private maxRetries: number;
  private eventsProcessor!: BlockchainEventsProcessor;
  private blockConfirmations: number;
  private lastUpdated: Date = new Date();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private blockSubscriptionActive: boolean = false;

  // Performance optimization properties
  private batchSize: number;
  private concurrentTransactionLimit: number = 10;
  private performanceMetrics = {
    blocksProcessed: 0,
    transactionsProcessed: 0,
    messagesPublished: 0,
    averageBlockTime: 0,
    lastProcessingTime: 0,
  };

  // Continuous indexing properties
  private latestBlockUpdateTimer: NodeJS.Timeout | null = null;
  private continuousIndexingTimer: NodeJS.Timeout | null = null;
  private latestBlockUpdateInterval: number;
  private continuousIndexingInterval: number;
  private isProcessingContinuous: boolean = false;

  /**
   * Creates a new blockchain indexer
   * @param provider - Blockchain provider for the specific chain
   * @param publisher - Redis publisher for outputting filtered transactions
   * @param chainName - Name of the blockchain
   * @param unprocessedBlocksService - Service for unprocessed blocks
   * @param processedBlocksService - Service for processed blocks
   * @param initialTopicFilters - Initial topic filters to apply
   * @param blockConfirmations - Number of block confirmations to wait before processing
   */
  constructor(
    private provider: BlockchainProvider,
    private publisher: RedisPublisher,
    private chainName: string,
    private unprocessedBlocksService: UnprocessedBlocksService,
    private processedBlocksService: ProcessedBlocksService,
    initialTopicFilters: TopicFilter[] = [],
    blockConfirmations?: number
  ) {
    this.topicFilters = [...initialTopicFilters];
    this.retryDelay = config.retryDelay;
    this.maxRetries = config.maxRetries;
    this.blockConfirmations = blockConfirmations || 2;
    this.batchSize = config.indexingBatchSize || 10;
    this.concurrentTransactionLimit = config.concurrentTransactionLimit || 10;
    this.latestBlockUpdateInterval = config.latestBlockUpdateInterval || 2000;
    this.continuousIndexingInterval = config.continuousIndexingInterval || 1000;

    this.initializeEventsProcessor();

    logger.info("Blockchain indexer created", {
      chainName,
      topicFilters: this.topicFilters.length,
      blockConfirmations: this.blockConfirmations,
      batchSize: this.batchSize,
      continuousIndexing: true,
    });
  }

  /**
   * Initialize the events processor
   */
  private async initializeEventsProcessor(): Promise<void> {
    try {
      const chainId = await this.provider.getChainId();
      this.eventsProcessor = new BlockchainEventsProcessor(
        this.chainName,
        chainId,
        this.provider
      );

      this.eventsProcessor.setConcurrentLimit(this.concurrentTransactionLimit);

      logger.info("Events processor initialized", {
        chainName: this.chainName,
        chainId,
        concurrentLimit: this.concurrentTransactionLimit,
      });
    } catch (error) {
      logger.error("Failed to initialize events processor", {
        chainName: this.chainName,
        error,
      });
      throw error;
    }
  }

  /**
   * Start the indexer with continuous processing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Indexer is already running", { chainName: this.chainName });
      return;
    }

    try {
      logger.info("Starting blockchain indexer with continuous processing", {
        chainName: this.chainName,
      });

      if (!this.publisher.isConnected()) {
        await this.publisher.connect();
      }

      this.isRunning = true;
      this.isPaused = false;

      this.latestBlock = await this.provider.getLatestBlock();

      const startingBlock = await this.determineStartingBlock();
      this.processedBlock = startingBlock - 1;

      logger.info("Determined starting block for indexing", {
        chainName: this.chainName,
        startingBlock,
        processedBlock: this.processedBlock,
        latestBlock: this.latestBlock,
      });

      this.startHealthCheck();
      this.subscribeToNewBlocks();

      // Start continuous indexing timers
      this.startContinuousIndexing();

      // Process initial backlog
      await this.processBacklog();

      logger.info(
        "Blockchain indexer started successfully with continuous processing",
        {
          chainName: this.chainName,
          latestBlock: this.latestBlock,
          processedBlock: this.processedBlock,
          continuousIndexing: true,
        }
      );
    } catch (error) {
      this.isRunning = false;
      logger.error("Failed to start blockchain indexer", {
        chainName: this.chainName,
        error,
      });
      throw error;
    }
  }

  /**
   * Stop the indexer and all continuous processing
   */
  async stop(): Promise<void> {
    logger.info("Stopping blockchain indexer", { chainName: this.chainName });

    this.unsubscribeFromNewBlocks();
    this.stopHealthCheck();
    this.stopContinuousIndexing();

    this.isRunning = false;
    this.isPaused = false;

    if (this.publisher.isConnected()) {
      await this.publisher.disconnect();
    }

    logger.info("Blockchain indexer stopped", { chainName: this.chainName });
  }

  /**
   * Pause the indexer (stops continuous processing)
   */
  async pause(): Promise<void> {
    if (!this.isRunning || this.isPaused) {
      logger.warn("Indexer is already paused or not running", {
        chainName: this.chainName,
      });
      return;
    }

    logger.info("Pausing blockchain indexer", { chainName: this.chainName });
    this.isPaused = true;
    this.stopContinuousIndexing();
  }

  /**
   * Resume the indexer (restarts continuous processing)
   */
  async resume(): Promise<void> {
    if (!this.isRunning || !this.isPaused) {
      logger.warn("Indexer is not paused or not running", {
        chainName: this.chainName,
      });
      return;
    }

    logger.info("Resuming blockchain indexer", { chainName: this.chainName });
    this.isPaused = false;
    this.startContinuousIndexing();

    try {
      await this.processBacklog();
    } catch (error) {
      logger.error("Error processing backlog during resume", {
        chainName: this.chainName,
        error,
      });
    }
  }

  /**
   * Start continuous indexing timers
   */
  private startContinuousIndexing(): void {
    if (this.latestBlockUpdateTimer || this.continuousIndexingTimer) {
      this.stopContinuousIndexing();
    }

    // Timer to update latest block every 2 seconds
    this.latestBlockUpdateTimer = setInterval(async () => {
      if (!this.isRunning || this.isPaused) {
        return;
      }

      try {
        const newLatestBlock = await this.provider.getLatestBlock();
        if (newLatestBlock > this.latestBlock) {
          const previousLatest = this.latestBlock;
          this.latestBlock = newLatestBlock;

          logger.debug("Latest block updated", {
            chainName: this.chainName,
            previousLatest,
            newLatest: this.latestBlock,
            newBlocks: this.latestBlock - previousLatest,
          });
        }
      } catch (error) {
        logger.error("Error updating latest block", {
          chainName: this.chainName,
          error,
        });
      }
    }, this.latestBlockUpdateInterval);

    // Timer to check for new blocks to process every 1 second
    this.continuousIndexingTimer = setInterval(async () => {
      if (!this.isRunning || this.isPaused || this.isProcessingContinuous) {
        return;
      }

      try {
        await this.processContinuousBlocks();
      } catch (error) {
        logger.error("Error in continuous block processing", {
          chainName: this.chainName,
          error,
        });
      }
    }, this.continuousIndexingInterval);

    logger.info("Started continuous indexing", {
      chainName: this.chainName,
      latestBlockUpdateInterval: this.latestBlockUpdateInterval,
      continuousIndexingInterval: this.continuousIndexingInterval,
    });
  }

  /**
   * Stop continuous indexing timers
   */
  private stopContinuousIndexing(): void {
    if (this.latestBlockUpdateTimer) {
      clearInterval(this.latestBlockUpdateTimer);
      this.latestBlockUpdateTimer = null;
    }

    if (this.continuousIndexingTimer) {
      clearInterval(this.continuousIndexingTimer);
      this.continuousIndexingTimer = null;
    }

    logger.info("Stopped continuous indexing", { chainName: this.chainName });
  }

  /**
   * Process new blocks continuously
   */
  private async processContinuousBlocks(): Promise<void> {
    if (this.isProcessingContinuous) {
      return;
    }

    this.isProcessingContinuous = true;

    try {
      const chainId = await this.provider.getChainId();
      const latestProcessed =
        await this.processedBlocksService.getLatestProcessedBlock(chainId);
      const currentProcessedBlock = latestProcessed
        ? latestProcessed.blockNumber
        : this.processedBlock;

      const targetBlock = Math.max(
        0,
        this.latestBlock - this.blockConfirmations
      );

      if (currentProcessedBlock >= targetBlock) {
        return;
      }

      const startBlock = currentProcessedBlock + 1;
      const blocksToProcess = targetBlock - currentProcessedBlock;

      logger.debug("Continuous processing check", {
        chainName: this.chainName,
        latestBlock: this.latestBlock,
        currentProcessedBlock,
        targetBlock,
        startBlock,
        blocksToProcess,
      });

      if (blocksToProcess > 0) {
        logger.info("Processing new blocks continuously", {
          chainName: this.chainName,
          startBlock,
          endBlock: targetBlock,
          blocksToProcess,
        });

        await this.processBlockRange(startBlock, targetBlock);

        this.processedBlock = targetBlock;
        this.lastUpdated = new Date();

        logger.info("Continuous block processing completed", {
          chainName: this.chainName,
          blocksProcessed: blocksToProcess,
          newProcessedBlock: this.processedBlock,
        });
      }
    } catch (error) {
      logger.error("Error in continuous block processing", {
        chainName: this.chainName,
        error,
      });
    } finally {
      this.isProcessingContinuous = false;
    }
  }

  /**
   * Get the current status of the indexer with continuous processing info
   */
  getStatus(): IndexerStatus {
    const blocksToProcess = Math.max(
      0,
      this.latestBlock - this.blockConfirmations - this.processedBlock
    );

    return {
      chainName: this.chainName,
      chainId: this.eventsProcessor ? this.eventsProcessor["chainId"] : 0,
      latestBlock: this.latestBlock,
      processedBlock: this.processedBlock,
      isHealthy: this.isRunning && !this.isPaused,
      lastUpdated: this.lastUpdated,
      isPaused: this.isPaused,
      blocksToProcess,
      continuousIndexing: this.isRunning && !this.isPaused,
      isProcessingContinuous: this.isProcessingContinuous,
    };
  }

  /**
   * Get the current status of the indexer with database-accurate processed block
   */
  async getDetailedStatus(): Promise<
    IndexerStatus & {
      latestProcessedFromDB?: number;
      blocksToProcess?: number;
      continuousIndexing?: boolean;
      isProcessingContinuous?: boolean;
    }
  > {
    try {
      const chainId = this.eventsProcessor
        ? this.eventsProcessor["chainId"]
        : 0;
      let latestProcessedFromDB: number | undefined;

      if (chainId > 0) {
        const latestProcessed =
          await this.processedBlocksService.getLatestProcessedBlock(chainId);
        latestProcessedFromDB = latestProcessed?.blockNumber;
      }

      const blocksToProcess = latestProcessedFromDB
        ? Math.max(
            0,
            this.latestBlock - this.blockConfirmations - latestProcessedFromDB
          )
        : Math.max(
            0,
            this.latestBlock - this.blockConfirmations - this.processedBlock
          );

      return {
        chainName: this.chainName,
        chainId,
        latestBlock: this.latestBlock,
        processedBlock: this.processedBlock,
        isHealthy: this.isRunning && !this.isPaused,
        lastUpdated: this.lastUpdated,
        isPaused: this.isPaused,
        latestProcessedFromDB,
        blocksToProcess,
        continuousIndexing: this.isRunning && !this.isPaused,
        isProcessingContinuous: this.isProcessingContinuous,
      };
    } catch (error) {
      logger.error("Error getting detailed status", {
        chainName: this.chainName,
        error,
      });
      return this.getStatus();
    }
  }

  /**
   * Process a specific block number atomically with optimizations
   * @param blockNumber - The block number to process
   */
  async processBlockNumber(blockNumber: number): Promise<void> {
    const startTime = Date.now();
    let unprocessedBlock: any = null;

    try {
      const chainId = await this.provider.getChainId();

      // Batch check for already processed blocks to reduce DB calls
      const isProcessed = await this.processedBlocksService.isBlockProcessed(
        chainId,
        blockNumber
      );
      if (isProcessed) {
        return;
      }

      const block = await this.provider.getBlockWithTransactions(blockNumber);

      if (!block) {
        logger.warn("Block not found", {
          chainName: this.chainName,
          blockNumber,
        });
        return;
      }

      // Parallel database operations
      const [addBlockResult] = await Promise.all([
        this.unprocessedBlocksService.addBlock(chainId, block),
        this.unprocessedBlocksService.checkForReorgs(chainId, block),
      ]);

      unprocessedBlock = addBlockResult;
      await this.unprocessedBlocksService.markAsProcessing(unprocessedBlock);

      const processedBlock = await this.eventsProcessor.processBlock(
        block,
        this.topicFilters
      );

      // Only log significant blocks or errors, not every block
      if (processedBlock.transactions.length > 0 || blockNumber % 100 === 0) {
        logger.info("Block processed by events processor", {
          chainName: this.chainName,
          blockNumber,
          totalTransactions: block.transactions?.length || 0,
          filteredTransactions: processedBlock.transactions.length,
        });
      }

      if (processedBlock.transactions.length > 0) {
        const messages: BlockchainMessage[] = processedBlock.transactions.map(
          (tx) => ({
            transaction: {
              hash: tx.hash,
              blockNumber: tx.blockNumber,
              chainId: tx.chainId,
              chainName: tx.chainName,
              from: tx.from,
              to: tx.to,
              value: tx.value || "0",
              gasUsed: tx.gasUsed?.toString(),
              gasPrice: tx.gasPrice?.toString(),
              status: tx.status || "1",
              logs: tx.logs || [],
              timestamp: processedBlock.timestamp,
              blockHash: tx.blockHash,
              data: tx.data || "",
              topics: tx.topics || [],
            },
            events: this.extractEventsFromLogs(tx.logs || []),
            timestamp: processedBlock.timestamp,
            metadata: {
              chainId: tx.chainId,
              chainName: tx.chainName,
              blockNumber: tx.blockNumber,
              transactionHash: tx.hash,
              timestamp: processedBlock.timestamp,
            },
          })
        );

        await this.publisher.publishMessages(messages);
        this.performanceMetrics.messagesPublished += messages.length;
      }

      // Parallel completion operations
      await Promise.all([
        this.unprocessedBlocksService.markAsCompleted(unprocessedBlock),
        this.processedBlocksService.addBlock(chainId, block),
      ]);

      this.lastUpdated = new Date();

      // Update performance metrics
      const processingTime = Date.now() - startTime;
      this.performanceMetrics.blocksProcessed++;
      this.performanceMetrics.transactionsProcessed +=
        block.transactions?.length || 0;
      this.performanceMetrics.lastProcessingTime = processingTime;
      this.performanceMetrics.averageBlockTime =
        (this.performanceMetrics.averageBlockTime *
          (this.performanceMetrics.blocksProcessed - 1) +
          processingTime) /
        this.performanceMetrics.blocksProcessed;
    } catch (error) {
      logger.error("Error processing block", {
        chainName: this.chainName,
        blockNumber,
        error,
      });

      if (unprocessedBlock) {
        try {
          await this.unprocessedBlocksService.markAsFailed(
            unprocessedBlock,
            error as Error
          );
        } catch (markFailedError) {
          logger.error("Failed to mark block as failed", {
            chainName: this.chainName,
            blockNumber,
            error: markFailedError,
          });
        }
      }

      throw error;
    }
  }

  /**
   * Process a range of blocks with optimized batch processing
   * @param startBlock - The starting block number
   * @param endBlock - The ending block number
   */
  async processBlockRange(startBlock: number, endBlock: number): Promise<void> {
    logger.info("Processing block range with optimizations", {
      chainName: this.chainName,
      startBlock,
      endBlock,
      count: endBlock - startBlock + 1,
      batchSize: this.batchSize,
    });

    // Process in smaller batches for better memory management and error isolation
    for (
      let batchStart = startBlock;
      batchStart <= endBlock;
      batchStart += this.batchSize
    ) {
      if (!this.isRunning || this.isPaused) {
        logger.info("Block range processing interrupted", {
          chainName: this.chainName,
          currentBatch: batchStart,
          processed: batchStart - startBlock,
          remaining: endBlock - batchStart + 1,
        });
        break;
      }

      const batchEnd = Math.min(batchStart + this.batchSize - 1, endBlock);

      try {
        await this.processBatch(batchStart, batchEnd);

        // Update processed block after successful batch
        this.processedBlock = batchEnd;

        // Log progress every 10 batches or at completion
        if (
          (batchStart - startBlock) % (this.batchSize * 10) === 0 ||
          batchEnd === endBlock
        ) {
          logger.info("Batch processing progress", {
            chainName: this.chainName,
            batchStart,
            batchEnd,
            progress: `${batchEnd - startBlock + 1}/${
              endBlock - startBlock + 1
            }`,
            avgBlockTime: this.performanceMetrics.averageBlockTime,
          });
        }
      } catch (error) {
        logger.error("Failed to process batch", {
          chainName: this.chainName,
          batchStart,
          batchEnd,
          error,
        });

        if (this.shouldStopOnError(error)) {
          logger.error(
            "Critical error encountered, stopping block processing",
            {
              chainName: this.chainName,
              batchStart,
              error,
            }
          );
          throw error;
        }

        // Continue with next batch on non-critical errors
        logger.warn("Non-critical error, continuing with next batch", {
          chainName: this.chainName,
          batchStart,
          batchEnd,
          error,
        });
      }
    }

    logger.info("Block range processing completed with optimizations", {
      chainName: this.chainName,
      startBlock,
      endBlock,
      blocksProcessed: Math.min(this.processedBlock, endBlock) - startBlock + 1,
      totalTime:
        this.performanceMetrics.averageBlockTime * (endBlock - startBlock + 1),
      avgBlockTime: this.performanceMetrics.averageBlockTime,
    });
  }

  /**
   * Process a batch of blocks sequentially (maintaining order)
   * @param startBlock - Start of batch
   * @param endBlock - End of batch
   */
  private async processBatch(
    startBlock: number,
    endBlock: number
  ): Promise<void> {
    for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
      if (!this.isRunning || this.isPaused) {
        break;
      }

      try {
        await this.processBlockNumberWithRetry(blockNumber);
      } catch (error) {
        logger.error("Failed to process block in batch", {
          chainName: this.chainName,
          blockNumber,
          error,
        });

        if (this.shouldStopOnError(error)) {
          throw error;
        }
      }
    }
  }

  /**
   * Process backlog of blocks with optimizations
   */
  private async processBacklog(): Promise<void> {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    try {
      const startTime = Date.now();
      this.latestBlock = await this.provider.getLatestBlock();
      const chainId = await this.provider.getChainId();

      const latestProcessed =
        await this.processedBlocksService.getLatestProcessedBlock(chainId);
      const startBlock = latestProcessed
        ? latestProcessed.blockNumber + 1
        : this.processedBlock + 1;

      const blocksToProcess = Math.max(0, this.latestBlock - startBlock + 1);

      logger.info("Backlog processing status", {
        chainName: this.chainName,
        latestBlock: this.latestBlock,
        latestProcessedFromDB: latestProcessed?.blockNumber,
        startBlock,
        blocksToProcess,
        estimatedTime:
          blocksToProcess * this.performanceMetrics.averageBlockTime,
      });

      if (startBlock > this.latestBlock) {
        return;
      }

      await this.processBlockRange(startBlock, this.latestBlock);

      if (latestProcessed) {
        this.processedBlock = Math.max(
          this.processedBlock,
          latestProcessed.blockNumber
        );
      }

      this.lastUpdated = new Date();
      const totalTime = Date.now() - startTime;

      logger.info("Backlog processing completed successfully", {
        chainName: this.chainName,
        startBlock,
        endBlock: this.latestBlock,
        blocksProcessed: this.latestBlock - startBlock + 1,
        totalTime,
        avgBlockTime: totalTime / (this.latestBlock - startBlock + 1),
        newProcessedBlock: this.processedBlock,
      });
    } catch (error) {
      logger.error("Error processing backlog", {
        chainName: this.chainName,
        error,
      });
    }
  }

  /**
   * Subscribe to new blocks from the blockchain
   */
  private subscribeToNewBlocks(): void {
    if (this.blockSubscriptionActive) {
      return;
    }

    let isProcessingBacklog = false;

    this.provider.subscribeToNewBlocks(async (blockNumber: number) => {
      if (!this.isRunning || this.isPaused) {
        return;
      }

      logger.debug("New block notification received", {
        chainName: this.chainName,
        blockNumber,
        isProcessingBacklog,
      });

      this.latestBlock = Math.max(this.latestBlock, blockNumber);

      if (!isProcessingBacklog) {
        isProcessingBacklog = true;

        try {
          await this.processBacklog();
        } catch (error) {
          logger.error("Error in new block backlog processing", {
            chainName: this.chainName,
            blockNumber,
            error,
          });
        } finally {
          isProcessingBacklog = false;
        }
      } else {
        logger.debug("Backlog processing already in progress, skipping", {
          chainName: this.chainName,
          blockNumber,
        });
      }
    });

    this.blockSubscriptionActive = true;

    logger.info("Subscribed to new blocks", { chainName: this.chainName });
  }

  /**
   * Unsubscribe from new blocks
   */
  private unsubscribeFromNewBlocks(): void {
    if (!this.blockSubscriptionActive) {
      return;
    }

    this.provider.unsubscribeFromNewBlocks();
    this.blockSubscriptionActive = false;

    logger.info("Unsubscribed from new blocks", { chainName: this.chainName });
  }

  /**
   * Start periodic health check
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        const providerHealthy = await this.provider.isHealthy();

        const publisherHealthy = this.publisher.isConnected();

        logger.debug("Health check", {
          chainName: this.chainName,
          providerHealthy,
          publisherHealthy,
          latestBlock: this.latestBlock,
          processedBlock: this.processedBlock,
        });

        if (!providerHealthy || !publisherHealthy) {
          logger.warn("Unhealthy state detected", {
            chainName: this.chainName,
            providerHealthy,
            publisherHealthy,
          });

          if (!publisherHealthy && this.isRunning) {
            try {
              await this.publisher.connect();
              logger.info("Reconnected Redis publisher", {
                chainName: this.chainName,
              });
            } catch (error) {
              logger.error("Failed to reconnect Redis publisher", {
                chainName: this.chainName,
                error,
              });
            }
          }
        }
      } catch (error) {
        logger.error("Error during health check", {
          chainName: this.chainName,
          error,
        });
      }
    }, config.healthCheckInterval);

    logger.info("Started health check", {
      chainName: this.chainName,
      interval: config.healthCheckInterval,
    });
  }

  /**
   * Stop periodic health check
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;

      logger.info("Stopped health check", { chainName: this.chainName });
    }
  }

  /**
   * Add a new topic filter
   * @param filter - The topic filter to add
   */
  addTopicFilter(filter: TopicFilter): void {
    const exists = this.topicFilters.some(
      (f) => f.hash.toLowerCase() === filter.hash.toLowerCase()
    );

    if (!exists) {
      this.topicFilters.push({
        hash: filter.hash.toLowerCase(),
        description: filter.description,
        contractAddress: filter.contractAddress
          ? filter.contractAddress.toLowerCase()
          : undefined,
      });

      logger.info("Added topic filter", {
        chainName: this.chainName,
        hash: filter.hash,
        description: filter.description,
        contractAddress: filter.contractAddress,
        totalFilters: this.topicFilters.length,
      });
    }
  }

  /**
   * Remove a topic filter
   * @param topicHash - The topic hash to remove
   */
  removeTopicFilter(topicHash: string): void {
    const initialLength = this.topicFilters.length;

    this.topicFilters = this.topicFilters.filter(
      (filter) => filter.hash.toLowerCase() !== topicHash.toLowerCase()
    );

    if (initialLength !== this.topicFilters.length) {
      logger.info("Removed topic filter", {
        chainName: this.chainName,
        hash: topicHash,
        totalFilters: this.topicFilters.length,
      });
    }
  }

  /**
   * Get all current topic filters
   */
  getTopicFilters(): TopicFilter[] {
    return [...this.topicFilters];
  }

  /**
   * Set the delay between retries for failed operations
   * @param milliseconds - Retry delay in milliseconds
   */
  setRetryDelay(milliseconds: number): void {
    this.retryDelay = milliseconds;
    logger.info("Set retry delay", {
      chainName: this.chainName,
      retryDelay: milliseconds,
    });
  }

  /**
   * Set maximum number of retries for operations
   * @param count - Maximum retry count
   */
  setMaxRetries(count: number): void {
    this.maxRetries = count;
    logger.info("Set max retries", {
      chainName: this.chainName,
      maxRetries: count,
    });
  }

  /**
   * Determine the starting block for indexing
   * Priority: DB latest processed block + 1 > Latest block - confirmations
   */
  private async determineStartingBlock(): Promise<number> {
    try {
      const chainId = await this.provider.getChainId();

      const latestProcessed =
        await this.processedBlocksService.getLatestProcessedBlock(chainId);

      if (latestProcessed) {
        const nextBlock = latestProcessed.blockNumber + 1;
        logger.info("Found latest processed block in database", {
          chainName: this.chainName,
          chainId,
          latestProcessedBlock: latestProcessed.blockNumber,
          nextBlockToProcess: nextBlock,
        });
        return nextBlock;
      }

      this.latestBlock = await this.provider.getLatestBlock();
      const defaultStartBlock = Math.max(0, this.latestBlock);

      logger.info(
        "No processed blocks in database, using latest block minus confirmations",
        {
          chainName: this.chainName,
          chainId,
          latestBlock: this.latestBlock,
          blockConfirmations: this.blockConfirmations,
          defaultStartBlock,
        }
      );

      return defaultStartBlock;
    } catch (error) {
      logger.error("Error determining starting block", {
        chainName: this.chainName,
        error,
      });
      throw error;
    }
  }

  /**
   * Extract structured events from transaction logs
   * @param logs - Raw transaction logs
   * @returns Parsed events array
   */
  private extractEventsFromLogs(logs: any[]): any[] {
    try {
      return logs.map((log, index) => ({
        logIndex: index,
        address: log.address || "",
        topics: log.topics || [],
        data: log.data || "",
        blockNumber: log.blockNumber || 0,
        transactionHash: log.transactionHash || "",
        transactionIndex: log.transactionIndex || 0,
        blockHash: log.blockHash || "",
        removed: log.removed || false,
      }));
    } catch (error) {
      logger.error("Error extracting events from logs", {
        chainName: this.chainName,
        error,
        logsCount: logs.length,
      });
      return [];
    }
  }

  /**
   * Process a block with retry logic
   * @param blockNumber - The block number to process
   */
  private async processBlockNumberWithRetry(
    blockNumber: number
  ): Promise<void> {
    let retries = 0;

    while (retries < this.maxRetries) {
      try {
        await this.processBlockNumber(blockNumber);
        return;
      } catch (error) {
        retries++;

        if (retries >= this.maxRetries) {
          logger.error("Max retries reached for processing block", {
            chainName: this.chainName,
            blockNumber,
            retries,
          });
          throw error;
        }

        logger.warn("Retrying block processing", {
          chainName: this.chainName,
          blockNumber,
          retry: retries,
          maxRetries: this.maxRetries,
        });

        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      }
    }
  }

  /**
   * Determine if processing should stop based on the error type
   * @param error - The error that occurred
   * @returns true if processing should stop, false to continue
   */
  private shouldStopOnError(error: any): boolean {
    const errorString = error?.message?.toLowerCase() || "";

    const criticalErrors = [
      "database",
      "connection refused",
      "network error",
      "timeout",
      "redis",
    ];

    return criticalErrors.some((critical) => errorString.includes(critical));
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      blocksPerSecond:
        this.performanceMetrics.averageBlockTime > 0
          ? 1000 / this.performanceMetrics.averageBlockTime
          : 0,
    };
  }

  /**
   * Set batch size for processing
   * @param size - Batch size
   */
  setBatchSize(size: number): void {
    this.batchSize = Math.max(1, Math.min(size, 100)); // Limit between 1-100
    logger.info("Set batch size", {
      chainName: this.chainName,
      batchSize: this.batchSize,
    });
  }

  /**
   * Set concurrent transaction processing limit
   * @param limit - Concurrent limit
   */
  setConcurrentTransactionLimit(limit: number): void {
    this.concurrentTransactionLimit = Math.max(1, Math.min(limit, 50)); // Limit between 1-50
    logger.info("Set concurrent transaction limit", {
      chainName: this.chainName,
      concurrentTransactionLimit: this.concurrentTransactionLimit,
    });
  }
}
