import { RedisConnectionOptions } from "./RedisPublisher";

/**
 * Redis configuration
 */
export interface RedisConfig {
  host: string;
  port: number;
  channel: string;
  options?: RedisConnectionOptions;
}

/**
 * Get Redis configuration from environment variables or use defaults
 * @returns Redis configuration object
 */
export function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    channel: process.env.REDIS_CHANNEL || "transactions",
    options: {
      password: process.env.REDIS_PASSWORD,
      database: process.env.REDIS_DB
        ? parseInt(process.env.REDIS_DB, 10)
        : undefined,
      username: process.env.REDIS_USERNAME,
      tls: process.env.REDIS_TLS === "true",
      retryDelayOnFailover: process.env.REDIS_RETRY_DELAY
        ? parseInt(process.env.REDIS_RETRY_DELAY, 10)
        : 1000,
      enableReadyCheck: process.env.REDIS_ENABLE_READY_CHECK !== "false",
      maxRetriesPerRequest: process.env.REDIS_MAX_RETRIES
        ? parseInt(process.env.REDIS_MAX_RETRIES, 10)
        : 3,
    },
  };
}
