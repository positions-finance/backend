import { Request, Response } from "express";
import { AppDataSource } from "@/database/data-source";
import { User } from "@/models/User";
import { Deposit } from "@/models/Deposit";
import { Withdrawal } from "@/models/Withdrawal";
import { Borrow } from "@/models/Borrow";
import { PocNft } from "@/models/PocNft";
import { UserService } from "@/services/UserService";
import logger from "@/utils/logger";

export class UserController {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  /**
   * Create a new user
   * @route POST /api/users
   */
  public createUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        walletAddress,
        totalUsdBalance,
        floatingUsdBalance,
        borrowedUsdAmount,
      } = req.body;

      if (!walletAddress) {
        res.status(400).json({
          success: false,
          error: "walletAddress is required",
        });
        return;
      }

      // Validate wallet address format (basic Ethereum address validation)
      const addressRegex = /^0x[a-fA-F0-9]{40}$/;
      if (!addressRegex.test(walletAddress)) {
        res.status(400).json({
          success: false,
          error: "Invalid wallet address format",
        });
        return;
      }

      const result = await this.userService.createUser({
        walletAddress,
        totalUsdBalance,
        floatingUsdBalance,
        borrowedUsdAmount,
      });

      res.status(result.isNewUser ? 201 : 200).json({
        success: true,
        data: {
          user: result.user,
          isNewUser: result.isNewUser,
          message: result.isNewUser
            ? "User created successfully"
            : "User already exists",
        },
      });
    } catch (error: any) {
      logger.error("Error creating user:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  /**
   * Get a user by wallet address
   * @route GET /api/users/:walletAddress
   */
  public getUserByWalletAddress = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        res.status(400).json({ error: "Wallet address is required" });
        return;
      }

      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { walletAddress: walletAddress.toLowerCase() },
        relations: ["pocNft"],
      });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json(user);
    } catch (error) {
      logger.error("Error fetching user:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  /**
   * Get user deposits
   * @route GET /api/users/:walletAddress/deposits
   */
  public getUserDeposits = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { walletAddress } = req.params;
      const { limit = 10, offset = 0 } = req.query;

      const depositRepository = AppDataSource.getRepository(Deposit);
      const deposits = await depositRepository
        .createQueryBuilder("deposit")
        .innerJoin(
          "deposit.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .orderBy("deposit.createdAt", "DESC")
        .take(Number(limit))
        .skip(Number(offset))
        .getMany();

      const total = await depositRepository
        .createQueryBuilder("deposit")
        .innerJoin(
          "deposit.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .getCount();

      res.json({
        data: deposits,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error("Error fetching user deposits:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  /**
   * Get user withdrawals
   * @route GET /api/users/:walletAddress/withdrawals
   */
  public getUserWithdrawals = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { walletAddress } = req.params;
      const { limit = 10, offset = 0 } = req.query;

      const withdrawalRepository = AppDataSource.getRepository(Withdrawal);
      const withdrawals = await withdrawalRepository
        .createQueryBuilder("withdrawal")
        .innerJoin(
          "withdrawal.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .orderBy("withdrawal.createdAt", "DESC")
        .take(Number(limit))
        .skip(Number(offset))
        .getMany();

      const total = await withdrawalRepository
        .createQueryBuilder("withdrawal")
        .innerJoin(
          "withdrawal.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .getCount();

      res.json({
        data: withdrawals,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error("Error fetching user withdrawals:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  /**
   * Get user borrows
   * @route GET /api/users/:walletAddress/borrows
   */
  public getUserBorrows = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { walletAddress } = req.params;
      const { limit = 10, offset = 0 } = req.query;

      const borrowRepository = AppDataSource.getRepository(Borrow);
      const borrows = await borrowRepository
        .createQueryBuilder("borrow")
        .innerJoin(
          "borrow.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .orderBy("borrow.createdAt", "DESC")
        .take(Number(limit))
        .skip(Number(offset))
        .getMany();

      const total = await borrowRepository
        .createQueryBuilder("borrow")
        .innerJoin(
          "borrow.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .getCount();

      res.json({
        data: borrows,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error("Error fetching user borrows:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  /**
   * Get user dashboard summary
   * @route GET /api/users/:walletAddress/summary
   */
  public getUserSummary = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { walletAddress } = req.params;

      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { walletAddress: walletAddress.toLowerCase() },
        relations: ["pocNft"],
      });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const updatedUser = await this.userService.recalculateUserBalances(
        walletAddress
      );

      if (!updatedUser) {
        res.status(500).json({ error: "Failed to update user balances" });
        return;
      }

      const depositRepository = AppDataSource.getRepository(Deposit);
      const depositCount = await depositRepository
        .createQueryBuilder("deposit")
        .innerJoin(
          "deposit.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .getCount();

      const withdrawalRepository = AppDataSource.getRepository(Withdrawal);
      const withdrawalCount = await withdrawalRepository
        .createQueryBuilder("withdrawal")
        .innerJoin(
          "withdrawal.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .getCount();

      const borrowRepository = AppDataSource.getRepository(Borrow);
      const borrowCount = await borrowRepository
        .createQueryBuilder("borrow")
        .innerJoin(
          "borrow.user",
          "user",
          "user.walletAddress = :walletAddress",
          {
            walletAddress: walletAddress.toLowerCase(),
          }
        )
        .getCount();

      res.json({
        walletAddress: updatedUser.walletAddress,
        totalUsdBalance: updatedUser.totalUsdBalance,
        floatingUsdBalance: updatedUser.floatingUsdBalance,
        borrowedUsdAmount: updatedUser.borrowedUsdAmount,
        hasNft: !!user.pocNft,
        nftDetails: user.pocNft,
        transactionCounts: {
          deposits: depositCount,
          withdrawals: withdrawalCount,
          borrows: borrowCount,
        },
        createdAt: updatedUser.createdAt,
      });
    } catch (error) {
      logger.error("Error fetching user summary:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
