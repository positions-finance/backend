import {
  BlockchainProvider,
  IndexerStatus,
  TopicFilter,
} from "./blockchain.types";
import { RedisPublisher } from "./redis.types";

export interface BlockchainIndexer {
  start(): Promise<void>;

  stop(): Promise<void>;

  pause(): Promise<void>;

  resume(): Promise<void>;

  getStatus(): IndexerStatus;

  getDetailedStatus(): Promise<
    IndexerStatus & { latestProcessedFromDB?: number }
  >;

  processBlockNumber(blockNumber: number): Promise<void>;

  processBlockRange(startBlock: number, endBlock: number): Promise<void>;

  addTopicFilter(filter: TopicFilter): void;

  removeTopicFilter(topicHash: string): void;

  getTopicFilters(): TopicFilter[];

  setRetryDelay(milliseconds: number): void;

  setMaxRetries(count: number): void;

  setBatchSize?(size: number): void;

  setConcurrentTransactionLimit?(limit: number): void;

  getPerformanceMetrics?(): any;
}

export interface BlockchainIndexerFactory {
  createIndexer(
    provider: BlockchainProvider,
    publisher: RedisPublisher,
    chainName: string,
    topicFilters: TopicFilter[],
    blockConfirmations?: number
  ): BlockchainIndexer;
}
