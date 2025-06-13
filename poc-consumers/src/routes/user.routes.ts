import { Router } from "express";
import { UserController } from "@/controllers/user.controller";

export const createUserRoutes = (): Router => {
  const router = Router();
  const userController = new UserController();

  /**
   * @route POST /api/users
   * @desc Create a new user
   * @access Public
   */
  router.post("/", userController.createUser);

  /**
   * @route GET /api/users/:walletAddress
   * @desc Get user by wallet address
   * @access Public
   */
  router.get("/:walletAddress", userController.getUserByWalletAddress);

  /**
   * @route GET /api/users/:walletAddress/deposits
   * @desc Get user deposits
   * @access Public
   */
  router.get("/:walletAddress/deposits", userController.getUserDeposits);

  /**
   * @route GET /api/users/:walletAddress/withdrawals
   * @desc Get user withdrawals
   * @access Public
   */
  router.get("/:walletAddress/withdrawals", userController.getUserWithdrawals);

  /**
   * @route GET /api/users/:walletAddress/borrows
   * @desc Get user borrows
   * @access Public
   */
  router.get("/:walletAddress/borrows", userController.getUserBorrows);

  /**
   * @route GET /api/users/:walletAddress/summary
   * @desc Get user dashboard summary
   * @access Public
   */
  router.get("/:walletAddress/summary", userController.getUserSummary);

  return router;
};
