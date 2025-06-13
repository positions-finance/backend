import dotenv from "dotenv";
import { EnvConfig } from "../utils/types/config.types";

dotenv.config();

const config: EnvConfig = {
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
  api: {
    port: parseInt(process.env.API_PORT || "8080", 10),
    host: process.env.API_HOST || "localhost",
  },
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    database: process.env.REDIS_DATABASE
      ? parseInt(process.env.REDIS_DATABASE, 10)
      : 0,
    channel: process.env.REDIS_CHANNEL || "blockchain-events",
    username: process.env.REDIS_USERNAME || undefined,
    tls: process.env.REDIS_TLS === "true",
  },
  chains: {
    berachain: {
      rpcUrl: process.env.BERACHAIN_RPC_URL || "",
      wsUrl: process.env.BERACHAIN_WS_URL || "",
      chainId: parseInt(process.env.BERACHAIN_CHAIN_ID || "80094", 10),
      blockConfirmations: parseInt(
        process.env.BERACHAIN_BLOCK_CONFIRMATIONS || "2",
        10
      ),
    },

    // "arbitrum-mainnet": {
    //   rpcUrl: process.env.ARBITRUM_MAINNET_RPC_URL || "",
    //   wsUrl: process.env.ARBITRUM_MAINNET_WS_URL || "",
    //   chainId: parseInt(process.env.ARBITRUM_MAINNET_CHAIN_ID || "42161", 10),
    //   blockConfirmations: parseInt(
    //     process.env.ARBITRUM_MAINNET_BLOCK_CONFIRMATIONS || "2",
    //     10
    //   ),
    // },
  },
  healthCheckInterval: parseInt(
    process.env.HEALTH_CHECK_INTERVAL || "30000",
    10
  ),
  retryDelay: parseInt(process.env.RETRY_DELAY || "100", 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
  indexingBatchSize: parseInt(process.env.INDEXING_BATCH_SIZE || "100", 10),
  concurrentTransactionLimit: parseInt(
    process.env.CONCURRENT_TRANSACTION_LIMIT || "100",
    10
  ),
  latestBlockUpdateInterval: parseInt(
    process.env.LATEST_BLOCK_UPDATE_INTERVAL || "2000",
    10
  ),
  continuousIndexingInterval: parseInt(
    process.env.CONTINUOUS_INDEXING_INTERVAL || "1000",
    10
  ),
  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    username: process.env.DB_USERNAME || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    name: process.env.DB_NAME || "blockchain_indexer",
    logging: process.env.DB_LOGGING === "true",
    ssl: process.env.DB_SSL === "true",
  },
};

export default config;
