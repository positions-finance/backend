import { Request, Response } from "express";
import { IConsumerService } from "@/interfaces/consumer.interface";
import logger from "@/utils/logger";

export class ConsumerController {
  private consumerService: IConsumerService;

  constructor(consumerService: IConsumerService) {
    this.consumerService = consumerService;
  }

  /**
   * Get the status of the consumer
   */
  getStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const status = this.consumerService.getStatus();
      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error("Error getting consumer status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get consumer status",
      });
    }
  };

  /**
   * Pause the consumer
   */
  pauseConsumer = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.consumerService.pause();
      res.json({
        success: true,
        message: "Consumer paused successfully",
      });
    } catch (error) {
      logger.error("Error pausing consumer:", error);
      res.status(500).json({
        success: false,
        error: "Failed to pause consumer",
      });
    }
  };

  /**
   * Resume the consumer
   */
  resumeConsumer = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.consumerService.resume();
      res.json({
        success: true,
        message: "Consumer resumed successfully",
      });
    } catch (error) {
      logger.error("Error resuming consumer:", error);
      res.status(500).json({
        success: false,
        error: "Failed to resume consumer",
      });
    }
  };

  /**
   * Trigger Merkle root generation manually
   */
  generateMerkleRoot = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.consumerService.triggerMerkleRootGeneration();
      res.json({
        success: true,
        message: result,
      });
    } catch (error) {
      logger.error("Error generating Merkle root:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate Merkle root",
      });
    }
  };
}
