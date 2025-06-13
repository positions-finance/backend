import { Router } from "express";
import { ConsumerController } from "@/controllers/consumer.controller";
import { IConsumerService } from "@/interfaces/consumer.interface";

export const createConsumerRoutes = (
  consumerService: IConsumerService
): Router => {
  const router = Router();
  const consumerController = new ConsumerController(consumerService);

  /**
   * @route GET /api/consumers/status
   * @desc Get consumer status
   * @access Public
   */
  router.get("/status", consumerController.getStatus);

  /**
   * @route POST /api/consumers/pause
   * @desc Pause the consumer
   * @access Public
   */
  router.post("/pause", consumerController.pauseConsumer);

  /**
   * @route POST /api/consumers/resume
   * @desc Resume the consumer
   * @access Public
   */
  router.post("/resume", consumerController.resumeConsumer);

  /**
   * @route POST /api/consumers/merkle
   * @desc Trigger Merkle root generation and submission
   * @access Public
   */
  router.post("/merkle", consumerController.generateMerkleRoot);

  return router;
};
