import { Block, TransactionResponse, TransactionReceipt } from "ethers";

export interface FilteredTransaction {
  blockHash: string;
  blockNumber: number;
  topics?: string[];
  chainId: number;
  chainName: string;
  from: string;
  to?: string;
  value: string;
  data?: string;
  hash: string;
  gasUsed?: string;
  gasPrice?: string;
  status?: string;
  logs?: any[];
}

export interface ProcessedBlock {
  blockHash: string;
  blockNumber: number;
  timestamp: number;
  transactions: FilteredTransaction[];
  chainId: number;
  chainName: string;
}

export interface TopicFilter {
  hash: string;
  description?: string;
  contractAddress?: string;
}

export interface IndexerStatus {
  chainName: string;
  chainId: number;
  latestBlock: number;
  processedBlock: number;
  isHealthy: boolean;
  lastUpdated: Date;
  isPaused: boolean;
  blocksToProcess?: number;
  continuousIndexing?: boolean;
  isProcessingContinuous?: boolean;
}

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

export interface BlockchainProvider {
  getLatestBlock(): Promise<number>;
  getBlock(blockNumber: number): Promise<Block | null>;
  getBlockWithTransactions(blockNumber: number): Promise<Block | null>;
  getTransaction(txHash: string): Promise<TransactionResponse | null>;
  getChainId(): Promise<number>;
  isHealthy(): Promise<boolean>;
  subscribeToNewBlocks(callback: (blockNumber: number) => void): void;
  unsubscribeFromNewBlocks(): void;
  getChainName(): string;
  getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null>;
}

export interface IndexerParams {
  chainName: string;
  provider: BlockchainProvider;
  topicFilters: TopicFilter[];
  blockConfirmations: number;
}

export interface EventsProcessor {
  processBlock(block: Block): Promise<ProcessedBlock>;
  filterTransactionsByTopics(
    transactions: string[],
    topics: TopicFilter[]
  ): Promise<FilteredTransaction[]>;
}
