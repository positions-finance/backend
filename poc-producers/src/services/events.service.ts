import { Block, Log, TransactionReceipt, TransactionResponse } from "ethers";
import {
  EventsProcessor,
  FilteredTransaction,
  ProcessedBlock,
  TopicFilter,
  BlockchainProvider,
} from "../utils/types/blockchain.types";
import logger from "../utils/logger";

/**
 * Simple BloomFilter implementation for efficient topic filtering
 * This reduces the need to check every topic against the full set
 */
class BloomFilter {
  private filter: Uint8Array;
  private size: number;
  private hashFunctions: number;

  constructor(size: number = 2048, hashFunctions: number = 3) {
    this.size = size;
    this.hashFunctions = hashFunctions;
    this.filter = new Uint8Array(size);
  }

  /**
   * Add a string to the bloom filter
   */
  add(str: string): void {
    for (let i = 0; i < this.hashFunctions; i++) {
      const position = this.hash(str, i) % this.size;
      this.filter[position] = 1;
    }
  }

  /**
   * Check if a string might be in the bloom filter
   * False positives are possible, but false negatives are not
   */
  mightContain(str: string): boolean {
    for (let i = 0; i < this.hashFunctions; i++) {
      const position = this.hash(str, i) % this.size;
      if (this.filter[position] === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Clear the bloom filter
   */
  clear(): void {
    this.filter.fill(0);
  }

  /**
   * Simple hash function for strings
   */
  private hash(str: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h = h & h;
    }
    return Math.abs(h);
  }
}

/**
 * Configuration options for the blockchain events processor
 */
export interface EventsProcessorConfig {
  initialConcurrentLimit?: number;
  minConcurrentLimit?: number;
  maxConcurrentLimit?: number;
  cacheSize?: number;
  enableDynamicConcurrency?: boolean;
  adjustmentIntervalMs?: number;
  metricsWindowSize?: number;
}

/**
 * Default configuration for the blockchain events processor
 */
const DEFAULT_CONFIG: EventsProcessorConfig = {
  initialConcurrentLimit: 10,
  minConcurrentLimit: 5,
  maxConcurrentLimit: 50,
  cacheSize: 1000,
  enableDynamicConcurrency: true,
  adjustmentIntervalMs: 60000, // 1 minute
  metricsWindowSize: 20,
};

/**
 * Implementation of blockchain events processor
 * Responsible for filtering transactions based on topic0 hashes
 */
export default class BlockchainEventsProcessor implements EventsProcessor {
  private concurrentLimit: number;
  private minConcurrentLimit: number;
  private maxConcurrentLimit: number;
  private receiptCache: Map<
    string,
    {
      receipt: TransactionReceipt | null;
      transaction: TransactionResponse | null;
    }
  > = new Map();
  private cacheSize: number;
  private abortController: AbortController | null = null;
  private enableDynamicConcurrency: boolean;

  private performanceMetrics = {
    processingTimes: [] as number[],
    successRates: [] as number[],
    lastAdjustmentTime: Date.now(),
    adjustmentInterval: 60000,
    metricsWindow: 20,
  };

  private topicBloomFilter: BloomFilter = new BloomFilter();

  private supportsBatchedRPC: boolean = false;
  private batchSize: number = 20;
  private rpcCallsCount: number = 0;

  /**
   * Constructor
   * @param chainName - Name of the blockchain
   * @param chainId - Chain ID of the blockchain
   * @param provider - Blockchain provider instance
   * @param config - Optional configuration options
   */
  constructor(
    private chainName: string,
    private chainId: number,
    private provider: BlockchainProvider,
    config: EventsProcessorConfig = {}
  ) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    this.concurrentLimit = mergedConfig.initialConcurrentLimit!;
    this.minConcurrentLimit = mergedConfig.minConcurrentLimit!;
    this.maxConcurrentLimit = mergedConfig.maxConcurrentLimit!;
    this.cacheSize = mergedConfig.cacheSize!;
    this.enableDynamicConcurrency = mergedConfig.enableDynamicConcurrency!;
    this.performanceMetrics.adjustmentInterval =
      mergedConfig.adjustmentIntervalMs!;
    this.performanceMetrics.metricsWindow = mergedConfig.metricsWindowSize!;

    this.receiptCache = new Map();

    this.detectBatchedRPCSupport();

    logger.info("Initialized blockchain events processor", {
      chainName,
      chainId,
      config: mergedConfig,
    });
  }

  /**
   * Detect if the provider supports batched RPC requests
   * This is an optimization to reduce network overhead
   */
  private async detectBatchedRPCSupport(): Promise<void> {
    try {
      this.supportsBatchedRPC = true;
      logger.debug("Assumed batched RPC support for provider", {
        chainName: this.chainName,
        supportsBatchedRPC: this.supportsBatchedRPC,
      });
    } catch (error) {
      this.supportsBatchedRPC = false;
      logger.debug("Batched RPC not supported for provider", {
        chainName: this.chainName,
        error,
      });
    }
  }

  /**
   * Process a block and filter transactions based on configured topic filters
   * @param block - The block to process with transactions
   * @param topicFilters - Array of topic filters to apply
   */
  async processBlock(
    block: Block,
    topicFilters: TopicFilter[] = []
  ): Promise<ProcessedBlock> {
    const startTime = Date.now();

    if (!topicFilters.length) {
      return this.createEmptyProcessedBlock(block);
    }

    if (!block.transactions || !Array.isArray(block.transactions)) {
      logger.warn("Block does not contain transactions array", {
        chainName: this.chainName,
        blockNumber: block.number,
      });

      return this.createEmptyProcessedBlock(block);
    }

    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    this.updateTopicBloomFilter(topicFilters);

    const totalTransactions = block.transactions.length;
    const filteredTransactions = await this.filterTransactionsByTopicsOptimized(
      block.transactions,
      topicFilters,
      this.abortController.signal
    );

    const processingTime = Date.now() - startTime;
    const successRate =
      filteredTransactions.length / Math.max(1, totalTransactions);

    this.updatePerformanceMetrics(processingTime, successRate);
    this.maybeAdjustConcurrency();

    if (filteredTransactions.length > 0 || Number(block.number) % 100 === 0) {
      logger.info("Block processed", {
        chainName: this.chainName,
        blockNumber: block.number,
        totalTransactions: totalTransactions,
        filteredTransactions: filteredTransactions.length,
        processingTimeMs: processingTime,
        concurrentLimit: this.concurrentLimit,
        rpcCalls: this.rpcCallsCount,
      });

      this.rpcCallsCount = 0;
    }

    return {
      blockHash: block.hash || "",
      blockNumber: Number(block.number) || 0,
      timestamp: Number(block.timestamp) || 0,
      transactions: filteredTransactions,
      chainId: this.chainId,
      chainName: this.chainName,
    };
  }

  /**
   * Update the bloom filter with the current topic filters
   * This is a quick way to check if a topic might be in our filter set
   */
  private updateTopicBloomFilter(topicFilters: TopicFilter[]): void {
    this.topicBloomFilter.clear();
    for (const filter of topicFilters) {
      this.topicBloomFilter.add(filter.hash.toLowerCase());
    }
  }

  /**
   * Update performance metrics for dynamic concurrency adjustment
   */
  private updatePerformanceMetrics(
    processingTime: number,
    successRate: number
  ): void {
    this.performanceMetrics.processingTimes.push(processingTime);
    this.performanceMetrics.successRates.push(successRate);

    if (
      this.performanceMetrics.processingTimes.length >
      this.performanceMetrics.metricsWindow
    ) {
      this.performanceMetrics.processingTimes.shift();
      this.performanceMetrics.successRates.shift();
    }
  }

  /**
   * Dynamically adjust concurrency based on performance metrics
   */
  private maybeAdjustConcurrency(): void {
    if (!this.enableDynamicConcurrency) {
      return;
    }

    const now = Date.now();

    if (
      now - this.performanceMetrics.lastAdjustmentTime <
      this.performanceMetrics.adjustmentInterval
    ) {
      return;
    }

    if (this.performanceMetrics.processingTimes.length < 5) {
      return;
    }

    this.performanceMetrics.lastAdjustmentTime = now;

    const avgProcessingTime =
      this.performanceMetrics.processingTimes.reduce((a, b) => a + b, 0) /
      this.performanceMetrics.processingTimes.length;

    const avgSuccessRate =
      this.performanceMetrics.successRates.reduce((a, b) => a + b, 0) /
      this.performanceMetrics.successRates.length;

    let newLimit = this.concurrentLimit;

    if (avgProcessingTime < 1000 && avgSuccessRate < 0.1) {
      newLimit = Math.min(this.maxConcurrentLimit, this.concurrentLimit + 5);
    } else if (avgProcessingTime > 5000) {
      newLimit = Math.max(this.minConcurrentLimit, this.concurrentLimit - 3);
    } else if (avgProcessingTime > 2000) {
      newLimit = Math.max(this.minConcurrentLimit, this.concurrentLimit - 1);
    }

    if (newLimit !== this.concurrentLimit) {
      this.concurrentLimit = newLimit;
      logger.info("Dynamically adjusted concurrent limit", {
        chainName: this.chainName,
        newConcurrentLimit: this.concurrentLimit,
        avgProcessingTimeMs: Math.round(avgProcessingTime),
        avgSuccessRate: avgSuccessRate.toFixed(4),
      });
    }
  }

  /**
   * Create an empty processed block object
   * @param block - Block data
   */
  private createEmptyProcessedBlock(block: Block): ProcessedBlock {
    return {
      blockHash: block.hash || "",
      blockNumber: Number(block.number) || 0,
      timestamp: Number(block.timestamp) || 0,
      transactions: [],
      chainId: this.chainId,
      chainName: this.chainName,
    };
  }

  /**
   * Optimized filter transactions by topic0 hashes with concurrent processing
   * @param transactions - Array of transactions to filter
   * @param topicFilters - Array of topic filters to apply
   * @param signal - AbortSignal to cancel processing
   */
  async filterTransactionsByTopicsOptimized(
    transactions: string[],
    topicFilters: TopicFilter[] = [],
    signal?: AbortSignal
  ): Promise<FilteredTransaction[]> {
    if (!topicFilters.length || !transactions.length) {
      return [];
    }

    // Create a set of topic hashes for faster lookups
    const topicHashSet = new Set(
      topicFilters.map((filter) => filter.hash.toLowerCase())
    );

    // Group topics by contract address for faster filtering
    const contractAddresses = new Set<string>();
    const topicsByContract = new Map<string, TopicFilter[]>();

    // Process topic filters to organize by contract
    for (const filter of topicFilters) {
      if (filter.contractAddress) {
        const contractAddr = filter.contractAddress.toLowerCase();
        contractAddresses.add(contractAddr);

        if (!topicsByContract.has(contractAddr)) {
          topicsByContract.set(contractAddr, []);
        }

        topicsByContract.get(contractAddr)!.push(filter);
      }
    }

    // Pre-filter transactions with optimizations for contract addresses
    const preFilteredTransactions = await this.preFilterTransactionsByContract(
      transactions,
      contractAddresses,
      signal
    );

    if (preFilteredTransactions.length === 0) {
      return [];
    }

    const batchSize = Math.min(
      this.concurrentLimit,
      preFilteredTransactions.length
    );
    const filteredTransactions: FilteredTransaction[] = [];

    if (this.supportsBatchedRPC && preFilteredTransactions.length > 5) {
      try {
        const batchResults = await this.processBatchedTransactions(
          preFilteredTransactions,
          topicHashSet,
          signal
        );

        filteredTransactions.push(
          ...(batchResults.filter(Boolean) as FilteredTransaction[])
        );
      } catch (error) {
        logger.warn(
          "Batched transaction processing failed, falling back to individual processing",
          {
            chainName: this.chainName,
            error,
          }
        );
        this.supportsBatchedRPC = false;

        for (let i = 0; i < preFilteredTransactions.length; i += batchSize) {
          if (signal?.aborted) break;

          const batch = preFilteredTransactions.slice(i, i + batchSize);
          const results = await this.processTransactionBatch(
            batch,
            topicHashSet,
            i,
            signal
          );
          filteredTransactions.push(
            ...(results.filter(Boolean) as FilteredTransaction[])
          );
        }
      }
    } else {
      for (let i = 0; i < preFilteredTransactions.length; i += batchSize) {
        if (signal?.aborted) {
          logger.info("Transaction processing aborted", {
            chainName: this.chainName,
            remaining: preFilteredTransactions.length - i,
          });
          break;
        }

        const batch = preFilteredTransactions.slice(i, i + batchSize);
        const results = await this.processTransactionBatch(
          batch,
          topicHashSet,
          i,
          signal
        );
        filteredTransactions.push(
          ...(results.filter(Boolean) as FilteredTransaction[])
        );
      }
    }

    if (this.receiptCache.size > this.cacheSize) {
      this.pruneCache();
    }

    return filteredTransactions;
  }

  /**
   * Process a batch of transactions
   */
  private async processTransactionBatch(
    batch: string[],
    topicHashSet: Set<string>,
    startIdx: number,
    signal?: AbortSignal
  ): Promise<(FilteredTransaction | null)[]> {
    const batchPromises = batch.map(async (tx, index) => {
      try {
        return await this.processTransactionOptimized(
          tx,
          topicHashSet,
          startIdx + index,
          signal
        );
      } catch (error) {
        if (signal?.aborted) {
          return null;
        }
        logger.error("Error processing transaction in batch", {
          hash: tx,
          error,
          chainName: this.chainName,
        });
        return null;
      }
    });

    return await Promise.all(batchPromises);
  }

  /**
   * Process transactions in a single batched RPC call if supported
   * This can significantly reduce network overhead
   */
  private async processBatchedTransactions(
    transactions: string[],
    topicHashSet: Set<string>,
    signal?: AbortSignal
  ): Promise<(FilteredTransaction | null)[]> {
    const uncachedTxs: string[] = [];
    const results: (FilteredTransaction | null)[] = new Array(
      transactions.length
    ).fill(null);

    for (let i = 0; i < transactions.length; i++) {
      const txHash = transactions[i];
      const cached = this.receiptCache.get(txHash);

      if (cached?.receipt) {
        results[i] = this.processReceiptFromCache(
          txHash,
          cached.receipt,
          cached.transaction,
          topicHashSet
        );
      } else {
        uncachedTxs.push(txHash);
      }
    }

    if (uncachedTxs.length === 0 || signal?.aborted) {
      return results;
    }

    try {
      const maxBatchSize = 20;

      for (let i = 0; i < uncachedTxs.length; i += maxBatchSize) {
        if (signal?.aborted) break;

        const batch = uncachedTxs.slice(i, i + maxBatchSize);

        const minimalTxs = await this.fetchMinimalTransactionBatch(batch);
        this.rpcCallsCount++;

        const contractTxs: string[] = [];
        const contractTxIndexes: number[] = [];

        for (let idx = 0; idx < batch.length; idx++) {
          const tx = minimalTxs[idx];
          if (tx && tx.data && tx.data !== "0x") {
            contractTxs.push(batch[idx]);
            contractTxIndexes.push(idx);
          }
        }

        if (contractTxs.length === 0) continue;

        const receipts = await this.fetchReceiptBatch(contractTxs);
        this.rpcCallsCount++;

        for (let j = 0; j < contractTxs.length; j++) {
          const txHash = contractTxs[j];
          const receipt = receipts[j];
          const batchIdx = contractTxIndexes[j];
          const tx = minimalTxs[batchIdx];

          if (!receipt || !tx) continue;

          this.receiptCache.set(txHash, { receipt, transaction: tx });

          const originalIdx = transactions.indexOf(txHash);
          if (originalIdx !== -1) {
            results[originalIdx] = this.processReceiptFromCache(
              txHash,
              receipt,
              tx,
              topicHashSet
            );
          }
        }
      }

      return results;
    } catch (error) {
      logger.error("Error in batched RPC processing", {
        chainName: this.chainName,
        error,
      });
      throw error;
    }
  }

  /**
   * Fetch minimal transaction data in batch
   * Only get the data we need for pre-filtering
   */
  private async fetchMinimalTransactionBatch(
    txHashes: string[]
  ): Promise<(TransactionResponse | null)[]> {
    try {
      const txPromises = txHashes.map((hash) =>
        this.provider.getTransaction(hash)
      );
      return await Promise.all(txPromises);
    } catch (error) {
      logger.error("Failed to fetch minimal transaction batch", {
        chainName: this.chainName,
        error,
        count: txHashes.length,
      });
      return [];
    }
  }

  /**
   * Fetch transaction receipts in batch
   */
  private async fetchReceiptBatch(
    txHashes: string[]
  ): Promise<(TransactionReceipt | null)[]> {
    try {
      const receiptPromises = txHashes.map((hash) =>
        this.provider.getTransactionReceipt(hash)
      );
      return await Promise.all(receiptPromises);
    } catch (error) {
      logger.error("Failed to fetch receipt batch", {
        chainName: this.chainName,
        error,
        count: txHashes.length,
      });
      return [];
    }
  }

  /**
   * Process a receipt from cache without making RPC calls
   */
  private processReceiptFromCache(
    txHash: string,
    receipt: TransactionReceipt | null,
    transaction: TransactionResponse | null,
    topicHashSet: Set<string>
  ): FilteredTransaction | null {
    if (
      !receipt ||
      !receipt.logs ||
      !Array.isArray(receipt.logs) ||
      receipt.logs.length === 0
    ) {
      return null;
    }

    const matchingTopics = new Set<string>();

    for (const log of receipt.logs as Log[]) {
      if (!log.topics || log.topics.length === 0) continue;

      const topic0 = log.topics[0].toLowerCase();

      if (
        this.topicBloomFilter.mightContain(topic0) &&
        topicHashSet.has(topic0)
      ) {
        matchingTopics.add(topic0);
      }
    }

    if (matchingTopics.size === 0) {
      return null;
    }

    const filteredLogs = receipt.logs.filter(
      (log) =>
        log.topics &&
        log.topics.length > 0 &&
        topicHashSet.has(log.topics[0].toLowerCase())
    );

    const topicsArray = Array.from(matchingTopics);

    return {
      blockHash: receipt.blockHash || "",
      blockNumber: receipt.blockNumber || 0,
      topics: topicsArray,
      chainId: this.chainId,
      chainName: this.chainName,
      hash: receipt.hash || "",
      from: receipt.from || "",
      to: receipt.to || undefined,
      value: transaction?.value?.toString() || "0",
      data: transaction?.data || "",
      gasUsed: receipt.gasUsed?.toString(),
      gasPrice: transaction?.gasPrice?.toString(),
      status: receipt.status?.toString() || "1",
      logs: filteredLogs,
    };
  }

  /**
   * Process a single transaction with optimizations
   * @param txHash - Transaction hash
   * @param topicHashSet - Set of topic hashes to match
   * @param originalIndex - Original index in the block for ordering
   * @param signal - AbortSignal to cancel processing
   */
  private async processTransactionOptimized(
    txHash: string,
    topicHashSet: Set<string>,
    originalIndex: number,
    signal?: AbortSignal
  ): Promise<FilteredTransaction | null> {
    try {
      let receipt: TransactionReceipt | null = null;
      let transaction: TransactionResponse | null = null;

      const cached = this.receiptCache.get(txHash);
      if (cached) {
        receipt = cached.receipt;
        transaction = cached.transaction;

        if (receipt) {
          return this.processReceiptFromCache(
            txHash,
            receipt,
            transaction,
            topicHashSet
          );
        }
      }

      if (transaction) {
        if (!transaction.data || transaction.data === "0x") {
          return null;
        }
      } else {
        if (signal?.aborted) {
          return null;
        }

        transaction = await this.provider.getTransaction(txHash);
        this.rpcCallsCount++;

        if (!transaction || transaction.data === "0x" || !transaction.data) {
          this.receiptCache.set(txHash, { receipt: null, transaction });
          return null;
        }
      }

      if (signal?.aborted) {
        return null;
      }

      receipt = await this.provider.getTransactionReceipt(txHash);
      this.rpcCallsCount++;

      this.receiptCache.set(txHash, { receipt, transaction });

      return this.processReceiptFromCache(
        txHash,
        receipt,
        transaction,
        topicHashSet
      );
    } catch (error) {
      if (signal?.aborted) {
        return null;
      }
      logger.error("Error processing individual transaction", {
        hash: txHash,
        error,
        chainName: this.chainName,
      });
      return null;
    }
  }

  /**
   * Pre-filter transactions based on type to avoid processing non-event transactions
   * @param transactions - Array of transaction hashes
   * @param signal - AbortSignal to cancel processing
   */
  private async preFilterTransactions(
    transactions: string[],
    signal?: AbortSignal
  ): Promise<string[]> {
    if (transactions.length <= this.concurrentLimit) {
      return transactions;
    }

    try {
      const sampleSize = Math.min(5, transactions.length);
      const sample = transactions.slice(0, sampleSize);
      let potentialContractCalls = 0;

      for (const txHash of sample) {
        if (signal?.aborted) {
          return [];
        }

        const cached = this.receiptCache.get(txHash);
        if (cached?.transaction) {
          if (cached.transaction.data && cached.transaction.data.length > 2) {
            potentialContractCalls++;
          }
          continue;
        }

        try {
          const tx = await this.provider.getTransaction(txHash);
          this.receiptCache.set(txHash, {
            receipt: null,
            transaction: tx,
          });

          if (tx?.data && tx.data.length > 2) {
            potentialContractCalls++;
          }
        } catch (err) {}
      }

      if (potentialContractCalls / sampleSize < 0.2) {
        logger.info("Pre-filtering transactions based on sample analysis", {
          chainName: this.chainName,
          sampleSize,
          potentialContractCallsRatio: potentialContractCalls / sampleSize,
        });

        const preFilteredBatch: string[] = [];

        const pfBatchSize = 20;
        for (let i = 0; i < transactions.length; i += pfBatchSize) {
          if (signal?.aborted) {
            return preFilteredBatch;
          }

          const batch = transactions.slice(i, i + pfBatchSize);
          const batchPromises = batch.map(async (txHash) => {
            const cached = this.receiptCache.get(txHash);
            if (cached?.transaction) {
              return cached.transaction.data &&
                cached.transaction.data.length > 2
                ? txHash
                : null;
            }

            try {
              const tx = await this.provider.getTransaction(txHash);
              this.receiptCache.set(txHash, {
                receipt: null,
                transaction: tx,
              });

              return tx?.data && tx.data.length > 2 ? txHash : null;
            } catch (err) {
              return txHash;
            }
          });

          const results = await Promise.all(batchPromises);
          preFilteredBatch.push(
            ...(results.filter((tx) => tx !== null) as string[])
          );
        }

        logger.info("Pre-filtering completed", {
          chainName: this.chainName,
          originalCount: transactions.length,
          filteredCount: preFilteredBatch.length,
          reductionPercent:
            (
              ((transactions.length - preFilteredBatch.length) /
                transactions.length) *
              100
            ).toFixed(2) + "%",
        });

        return preFilteredBatch;
      }
    } catch (error) {
      logger.warn("Error during transaction pre-filtering, skipping", {
        chainName: this.chainName,
        error,
      });
    }

    return transactions;
  }

  /**
   * Pre-filter transactions based on contract addresses and transaction type
   * This optimizes the filtering by only processing transactions that interact with monitored contracts
   * @param transactions - Array of transaction hashes
   * @param contractAddresses - Set of contract addresses to filter by
   * @param signal - AbortSignal to cancel processing
   */
  private async preFilterTransactionsByContract(
    transactions: string[],
    contractAddresses: Set<string>,
    signal?: AbortSignal
  ): Promise<string[]> {
    if (contractAddresses.size === 0) {
      return this.preFilterTransactions(transactions, signal);
    }

    if (transactions.length <= this.concurrentLimit) {
      return transactions;
    }

    try {
      logger.info("Pre-filtering transactions by contract addresses", {
        chainName: this.chainName,
        totalTransactions: transactions.length,
        contractCount: contractAddresses.size,
      });

      const preFilteredBatch: string[] = [];
      const pfBatchSize = 20;

      for (let i = 0; i < transactions.length; i += pfBatchSize) {
        if (signal?.aborted) {
          return preFilteredBatch;
        }

        const batch = transactions.slice(i, i + pfBatchSize);
        const batchPromises = batch.map(async (txHash) => {
          const cached = this.receiptCache.get(txHash);
          if (cached?.transaction) {
            if (
              cached.transaction.to &&
              contractAddresses.has(cached.transaction.to.toLowerCase())
            ) {
              return txHash;
            }

            return cached.transaction.data && cached.transaction.data.length > 2
              ? txHash
              : null;
          }

          try {
            const tx = await this.provider.getTransaction(txHash);
            this.rpcCallsCount++;

            this.receiptCache.set(txHash, {
              receipt: null,
              transaction: tx,
            });

            if (tx?.to && contractAddresses.has(tx.to.toLowerCase())) {
              return txHash;
            }

            return tx?.data && tx.data.length > 2 ? txHash : null;
          } catch (err) {
            return txHash;
          }
        });

        const results = await Promise.all(batchPromises);
        preFilteredBatch.push(
          ...(results.filter((tx) => tx !== null) as string[])
        );
      }

      logger.info("Pre-filtering by contract addresses completed", {
        chainName: this.chainName,
        originalCount: transactions.length,
        filteredCount: preFilteredBatch.length,
        reductionPercent:
          (
            ((transactions.length - preFilteredBatch.length) /
              transactions.length) *
            100
          ).toFixed(2) + "%",
      });

      return preFilteredBatch;
    } catch (error) {
      logger.warn(
        "Error during contract-based transaction pre-filtering, falling back to standard pre-filtering",
        {
          chainName: this.chainName,
          error,
        }
      );
      return this.preFilterTransactions(transactions, signal);
    }
  }

  /**
   * Prune the transaction receipt cache to keep it under the size limit
   */
  private pruneCache(): void {
    const entriesToKeep = Math.floor(this.cacheSize * 0.75);
    const entries = Array.from(this.receiptCache.entries());

    this.receiptCache = new Map(entries.slice(-entriesToKeep));

    logger.debug("Pruned transaction receipt cache", {
      chainName: this.chainName,
      beforeSize: entries.length,
      afterSize: this.receiptCache.size,
    });
  }

  /**
   * @param transactions - Array of transactions to filter
   * @param topicFilters - Array of topic filters to apply
   */
  async filterTransactionsByTopics(
    transactions: string[],
    topicFilters: TopicFilter[]
  ): Promise<FilteredTransaction[]> {
    return this.filterTransactionsByTopicsOptimized(transactions, topicFilters);
  }

  /**
   * Set concurrent processing limit
   * @param limit - Number of concurrent transactions to process
   */
  setConcurrentLimit(limit: number): void {
    this.concurrentLimit = Math.max(
      this.minConcurrentLimit,
      Math.min(limit, this.maxConcurrentLimit)
    );
    logger.info("Set concurrent limit for events processor", {
      chainName: this.chainName,
      concurrentLimit: this.concurrentLimit,
    });
  }

  /**
   * Enable or disable dynamic concurrency adjustment
   * @param enable - Whether to enable dynamic concurrency adjustment
   */
  setDynamicConcurrency(enable: boolean): void {
    this.enableDynamicConcurrency = enable;
    logger.info("Set dynamic concurrency for events processor", {
      chainName: this.chainName,
      enabled: enable,
    });
  }

  /**
   * Get current concurrent limit
   */
  getConcurrentLimit(): number {
    return this.concurrentLimit;
  }

  /**
   * Set the transaction receipt cache size
   * @param size - Maximum number of receipts to cache
   */
  setCacheSize(size: number): void {
    this.cacheSize = Math.max(100, Math.min(size, 10000)); // Limit between 100-10000
    logger.info("Set cache size for events processor", {
      chainName: this.chainName,
      cacheSize: this.cacheSize,
    });
  }

  /**
   * Cancel any ongoing transaction processing
   */
  cancelProcessing(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      logger.info("Cancelled transaction processing", {
        chainName: this.chainName,
      });
    }
  }
}
