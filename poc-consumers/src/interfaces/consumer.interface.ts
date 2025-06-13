/**
 * Common interface for consumer services (Kafka, Redis, etc.)
 */
export interface IConsumerService {
  /**
   * Start the consumer service
   */
  start(): Promise<void>;

  /**
   * Stop the consumer service
   */
  stop(): Promise<void>;

  /**
   * Pause the consumer
   */
  pause(): Promise<void>;

  /**
   * Resume the consumer
   */
  resume(): Promise<void>;

  /**
   * Get the consumer status
   */
  getStatus(): { isRunning: boolean };

  /**
   * Manually trigger Merkle root generation and submission
   */
  triggerMerkleRootGeneration(): Promise<string>;
}
