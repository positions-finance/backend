import { Router } from "express";
import { StatsController } from "@/controllers/stats.controller";

export const createStatsRoutes = (): Router => {
  const router = Router();
  const statsController = new StatsController();

  /**
   * @route GET /api/stats/overview
   * @desc Get platform overview statistics
   * @access Public
   */
  router.get("/overview", statsController.getOverviewStats);

  /**
   * @route GET /api/stats/transactions
   * @desc Get transaction history with pagination
   * @access Public
   */
  router.get("/transactions", statsController.getTransactionHistory);

  return router;
};
