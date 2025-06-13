import { config } from "dotenv";

config();

/**
 * Environment configuration with validation
 */
const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  API_PORT: parseInt(process.env.API_PORT || "3001", 10),
  API_HOST: process.env.API_HOST || "0.0.0.0",

  REDIS: {
    HOST: process.env.REDIS_HOST || "localhost",
    PORT: parseInt(process.env.REDIS_PORT || "6379", 10),
    PASSWORD: process.env.REDIS_PASSWORD || undefined,
    DATABASE: parseInt(process.env.REDIS_DATABASE || "0", 10),
    CHANNEL: process.env.REDIS_CHANNEL || "blockchain-events",
    USERNAME: process.env.REDIS_USERNAME || undefined,
    TLS: process.env.REDIS_TLS === "true",
  },

  DB: {
    HOST: process.env.DB_HOST || "localhost",
    PORT: parseInt(process.env.DB_PORT || "5432", 10),
    USERNAME: process.env.DB_USERNAME || "postgres",
    PASSWORD: process.env.DB_PASSWORD || "postgres",
    NAME: process.env.DB_NAME || "blockchain_consumer",
    LOGGING: process.env.DB_LOGGING === "true",
    SSL: process.env.DB_SSL === "true",
  },

  BLOCKCHAIN: {
    PRIVATE_KEY: process.env.PRIVATE_KEY || "",
    BERACHAIN_RPC_URL:
      process.env.BERACHAIN_RPC_URL || "https://bartio.rpc.berachain.com/",
    POSITIONS_NFT_ADDRESS: "0x11A5398855dDe5e08D87bAcb0d86ef682f7DE118",
  },

  ALCHEMY: {
    API_KEY: process.env.ALCHEMY_API_KEY || "",
    PRICES_API_URL: "https://api.g.alchemy.com/prices/v1",
  },

  HEALTH_CHECK_INTERVAL: parseInt(
    process.env.HEALTH_CHECK_INTERVAL || "60000",
    10
  ),
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY || "5000", 10),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || "5", 10),
  PROCESSING_BATCH_SIZE: parseInt(
    process.env.PROCESSING_BATCH_SIZE || "100",
    10
  ),
};

/**
 * Validate required environment variables
 */
function validateEnv(): void {
  const requiredEnvVars: (keyof typeof env)[] = [];

  const missingEnvVars = requiredEnvVars.filter((key) => !env[key]);

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvVars.join(", ")}`
    );
  }
}

validateEnv();

export default env;
