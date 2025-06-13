import { Request, Response } from "express";
import { AppDataSource } from "@/database/data-source";
import { User } from "@/models/User";
import { Deposit } from "@/models/Deposit";
import { Withdrawal } from "@/models/Withdrawal";
import { Borrow } from "@/models/Borrow";
import logger from "@/utils/logger";

interface TransactionRecord {
  id: string;
  txHash: string;
  amount: number;
  tokenSymbol: string;
  usdValue: number;
  createdAt: Date;
  user: { walletAddress: string };
  type?: string;
}

export class StatsController {
  /**
   * Get platform overview statistics
   * @route GET /api/stats/overview
   */
  public getOverviewStats = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const userRepository = AppDataSource.getRepository(User);
      const depositRepository = AppDataSource.getRepository(Deposit);
      const withdrawalRepository = AppDataSource.getRepository(Withdrawal);
      const borrowRepository = AppDataSource.getRepository(Borrow);

      // Get total users count
      const totalUsers = await userRepository.count();

      // Get total USD value in the platform
      const { totalUsd } = await userRepository
        .createQueryBuilder("user")
        .select("SUM(user.totalUsdBalance)", "totalUsd")
        .getRawOne();

      // Get total borrowed amount
      const { totalBorrowed } = await userRepository
        .createQueryBuilder("user")
        .select("SUM(user.borrowedUsdAmount)", "totalBorrowed")
        .getRawOne();

      // Get transaction counts
      const totalDeposits = await depositRepository.count();
      const totalWithdrawals = await withdrawalRepository.count();
      const totalBorrows = await borrowRepository.count();

      // Get recent transactions (limited to 5)
      const recentDeposits = await depositRepository
        .createQueryBuilder("deposit")
        .leftJoinAndSelect("deposit.user", "user")
        .select([
          "deposit.id",
          "deposit.txHash",
          "deposit.amount",
          "deposit.tokenSymbol",
          "deposit.usdValue",
          "deposit.createdAt",
          "user.walletAddress",
        ])
        .orderBy("deposit.createdAt", "DESC")
        .take(5)
        .getMany();

      const recentWithdrawals = await withdrawalRepository
        .createQueryBuilder("withdrawal")
        .leftJoinAndSelect("withdrawal.user", "user")
        .select([
          "withdrawal.id",
          "withdrawal.txHash",
          "withdrawal.amount",
          "withdrawal.tokenSymbol",
          "withdrawal.usdValue",
          "withdrawal.createdAt",
          "user.walletAddress",
        ])
        .orderBy("withdrawal.createdAt", "DESC")
        .take(5)
        .getMany();

      const recentBorrows = await borrowRepository
        .createQueryBuilder("borrow")
        .leftJoinAndSelect("borrow.user", "user")
        .select([
          "borrow.id",
          "borrow.txHash",
          "borrow.amount",
          "borrow.tokenSymbol",
          "borrow.usdValue",
          "borrow.createdAt",
          "user.walletAddress",
        ])
        .orderBy("borrow.createdAt", "DESC")
        .take(5)
        .getMany();

      res.json({
        platformStats: {
          totalUsers,
          totalValueLocked: totalUsd || 0,
          totalBorrowed: totalBorrowed || 0,
          transactions: {
            deposits: totalDeposits,
            withdrawals: totalWithdrawals,
            borrows: totalBorrows,
            total: totalDeposits + totalWithdrawals + totalBorrows,
          },
        },
        recentActivity: {
          deposits: recentDeposits,
          withdrawals: recentWithdrawals,
          borrows: recentBorrows,
        },
      });
    } catch (error) {
      logger.error("Error fetching overview stats:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

  /**
   * Get transaction history with pagination
   * @route GET /api/stats/transactions
   */
  public getTransactionHistory = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { limit = 10, offset = 0, type } = req.query;

      let deposits: any[] = [];
      let withdrawals: any[] = [];
      let borrows: any[] = [];
      let totalDeposits = 0;
      let totalWithdrawals = 0;
      let totalBorrows = 0;

      const depositRepository = AppDataSource.getRepository(Deposit);
      const withdrawalRepository = AppDataSource.getRepository(Withdrawal);
      const borrowRepository = AppDataSource.getRepository(Borrow);

      if (!type || type === "deposit") {
        deposits = await depositRepository
          .createQueryBuilder("deposit")
          .leftJoinAndSelect("deposit.user", "user")
          .select([
            "deposit.id",
            "deposit.txHash",
            "deposit.amount",
            "deposit.tokenSymbol",
            "deposit.usdValue",
            "deposit.createdAt",
            "user.walletAddress",
          ])
          .orderBy("deposit.createdAt", "DESC")
          .take(!type ? Math.floor(Number(limit) / 3) : Number(limit))
          .skip(!type ? Math.floor(Number(offset) / 3) : Number(offset))
          .getMany();

        totalDeposits = await depositRepository.count();
      }

      if (!type || type === "withdrawal") {
        withdrawals = await withdrawalRepository
          .createQueryBuilder("withdrawal")
          .leftJoinAndSelect("withdrawal.user", "user")
          .select([
            "withdrawal.id",
            "withdrawal.txHash",
            "withdrawal.amount",
            "withdrawal.tokenSymbol",
            "withdrawal.usdValue",
            "withdrawal.createdAt",
            "user.walletAddress",
          ])
          .orderBy("withdrawal.createdAt", "DESC")
          .take(!type ? Math.floor(Number(limit) / 3) : Number(limit))
          .skip(!type ? Math.floor(Number(offset) / 3) : Number(offset))
          .getMany();

        totalWithdrawals = await withdrawalRepository.count();
      }

      if (!type || type === "borrow") {
        borrows = await borrowRepository
          .createQueryBuilder("borrow")
          .leftJoinAndSelect("borrow.user", "user")
          .select([
            "borrow.id",
            "borrow.txHash",
            "borrow.amount",
            "borrow.tokenSymbol",
            "borrow.usdValue",
            "borrow.createdAt",
            "user.walletAddress",
          ])
          .orderBy("borrow.createdAt", "DESC")
          .take(!type ? Math.floor(Number(limit) / 3) : Number(limit))
          .skip(!type ? Math.floor(Number(offset) / 3) : Number(offset))
          .getMany();

        totalBorrows = await borrowRepository.count();
      }

      // Combine and sort by date if no specific type is requested
      let transactions: TransactionRecord[] = [];
      if (!type) {
        transactions = [
          ...deposits.map((d) => ({ ...d, type: "deposit" })),
          ...withdrawals.map((w) => ({ ...w, type: "withdrawal" })),
          ...borrows.map((b) => ({ ...b, type: "borrow" })),
        ]
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )
          .slice(0, Number(limit));
      } else {
        transactions =
          type === "deposit"
            ? deposits.map((d) => ({ ...d, type: "deposit" }))
            : type === "withdrawal"
            ? withdrawals.map((w) => ({ ...w, type: "withdrawal" }))
            : borrows.map((b) => ({ ...b, type: "borrow" }));
      }

      res.json({
        data: transactions,
        pagination: {
          total: totalDeposits + totalWithdrawals + totalBorrows,
          totalByType: {
            deposit: totalDeposits,
            withdrawal: totalWithdrawals,
            borrow: totalBorrows,
          },
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error("Error fetching transaction history:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
