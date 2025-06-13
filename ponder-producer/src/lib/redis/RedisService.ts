import {
  RedisPublisher,
  RedisPublisherImpl,
  RedisConnectionOptions,
} from "./RedisPublisher";

/**
 * Service for managing the Redis publisher instance
 */
export class RedisService {
  private static instance: RedisService;
  private publisher: RedisPublisher | null = null;

  private constructor() {}

  /**
   * Get the singleton instance of the RedisService
   * @returns The RedisService instance
   */
  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  /**
   * Initialize the Redis publisher
   * @param host Redis host
   * @param port Redis port
   * @param channel Redis channel
   * @param options Redis connection options
   * @returns The initialized Redis publisher
   */
  public async initPublisher(
    host: string,
    port: number,
    channel: string,
    options?: RedisConnectionOptions
  ): Promise<RedisPublisher> {
    if (!this.publisher) {
      this.publisher = new RedisPublisherImpl(host, port, channel, options);
      await this.publisher.connect();
    }
    return this.publisher;
  }

  /**
   * Get the current Redis publisher instance
   * @returns The Redis publisher
   * @throws Error if the publisher has not been initialized
   */
  public getPublisher(): RedisPublisher {
    if (!this.publisher) {
      throw new Error(
        "Redis publisher not initialized. Call initPublisher first."
      );
    }
    return this.publisher;
  }

  /**
   * Close the Redis publisher connection
   */
  public async closePublisher(): Promise<void> {
    if (this.publisher) {
      await this.publisher.disconnect();
      this.publisher = null;
    }
  }
}
