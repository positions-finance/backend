import { Repository } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { User } from "@/models/User";
import { Deposit } from "@/models/Deposit";
import { Withdrawal } from "@/models/Withdrawal";
import { Borrow } from "@/models/Borrow";
import logger from "@/utils/logger";
import { safeAdd, safeSubtract } from "@/utils/decimal";

export interface CreateUserRequest {
  walletAddress: string;
  totalUsdBalance?: number;
  floatingUsdBalance?: number;
  borrowedUsdAmount?: number;
}

export interface CreateUserResponse {
  user: User;
  isNewUser: boolean;
}

export class UserService {
  private userRepository: Repository<User>;
  private depositRepository: Repository<Deposit>;
  private withdrawalRepository: Repository<Withdrawal>;
  private borrowRepository: Repository<Borrow>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
    this.depositRepository = AppDataSource.getRepository(Deposit);
    this.withdrawalRepository = AppDataSource.getRepository(Withdrawal);
    this.borrowRepository = AppDataSource.getRepository(Borrow);
  }

  /**
   * Create a new user or return existing user
   * @param request User creation request data
   * @returns User data and whether it's a new user
   */
  async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
    try {
      const normalizedAddress = request.walletAddress.toLowerCase();

      // Check if user already exists
      const existingUser = await this.userRepository.findOne({
        where: { walletAddress: normalizedAddress },
        relations: ["pocNft"],
      });

      if (existingUser) {
        logger.info(`User already exists: ${normalizedAddress}`);
        return {
          user: existingUser,
          isNewUser: false,
        };
      }

      // Create new user
      const newUser = new User();
      newUser.walletAddress = normalizedAddress;
      newUser.totalUsdBalance = request.totalUsdBalance || 0;
      newUser.floatingUsdBalance = request.floatingUsdBalance || 0;
      newUser.borrowedUsdAmount = request.borrowedUsdAmount || 0;

      const savedUser = await this.userRepository.save(newUser);
      logger.info(`Created new user: ${normalizedAddress}`);

      return {
        user: savedUser,
        isNewUser: true,
      };
    } catch (error) {
      logger.error(`Error creating user: ${error}`);
      throw error;
    }
  }

  /**
   * Get user by wallet address
   * @param walletAddress User's wallet address
   * @returns User if found, null otherwise
   */
  async getUserByWalletAddress(walletAddress: string): Promise<User | null> {
    try {
      const normalizedAddress = walletAddress.toLowerCase();
      const user = await this.userRepository.findOne({
        where: { walletAddress: normalizedAddress },
        relations: ["pocNft"],
      });

      return user;
    } catch (error) {
      logger.error(`Error getting user by wallet address: ${error}`);
      throw error;
    }
  }

  /**
   * Update user balances
   * @param walletAddress User's wallet address
   * @param updates Balance updates
   * @returns Updated user
   */
  async updateUserBalances(
    walletAddress: string,
    updates: {
      totalUsdBalance?: number;
      floatingUsdBalance?: number;
      borrowedUsdAmount?: number;
    }
  ): Promise<User | null> {
    try {
      const normalizedAddress = walletAddress.toLowerCase();
      const user = await this.userRepository.findOne({
        where: { walletAddress: normalizedAddress },
      });

      if (!user) {
        logger.warn(`User not found for balance update: ${normalizedAddress}`);
        return null;
      }

      if (updates.totalUsdBalance !== undefined) {
        user.totalUsdBalance = updates.totalUsdBalance;
      }
      if (updates.floatingUsdBalance !== undefined) {
        user.floatingUsdBalance = updates.floatingUsdBalance;
      }
      if (updates.borrowedUsdAmount !== undefined) {
        user.borrowedUsdAmount = updates.borrowedUsdAmount;
      }

      const updatedUser = await this.userRepository.save(user);
      logger.info(`Updated balances for user: ${normalizedAddress}`);

      return updatedUser;
    } catch (error) {
      logger.error(`Error updating user balances: ${error}`);
      throw error;
    }
  }

  /**
   * Recalculate user balances based on deposits, withdrawals, and borrows
   * @param walletAddress User's wallet address
   * @returns Updated user with recalculated balances
   */
  async recalculateUserBalances(walletAddress: string): Promise<User | null> {
    try {
      const normalizedAddress = walletAddress.toLowerCase();
      const user = await this.userRepository.findOne({
        where: { walletAddress: normalizedAddress },
      });

      if (!user) {
        logger.warn(
          `User not found for balance recalculation: ${normalizedAddress}`
        );
        return null;
      }

      const deposits = await this.depositRepository.find({
        where: { user: { id: user.id } },
      });

      const withdrawals = await this.withdrawalRepository.find({
        where: { user: { id: user.id } },
      });

      const borrows = await this.borrowRepository.find({
        where: { user: { id: user.id } },
      });

      const totalDeposits = deposits.reduce(
        (sum, deposit) => safeAdd(sum, Number(deposit.usdValueAtDeposit)),
        0
      );

      const totalWithdrawals = withdrawals.reduce((sum, withdrawal) => {
        if (withdrawal.status === "completed") {
          return safeAdd(sum, Number(withdrawal.usdValueAtWithdrawal));
        }
        return sum;
      }, 0);

      const netDepositAmount = safeSubtract(totalDeposits, totalWithdrawals);

      const totalBorrowedAmount = borrows.reduce((sum, borrow) => {
        if (borrow.status === "active") {
          return safeAdd(sum, Number(borrow.borrowedUsdAmount));
        }
        return sum;
      }, 0);

      user.totalUsdBalance = netDepositAmount;
      user.borrowedUsdAmount = totalBorrowedAmount;
      user.floatingUsdBalance = safeSubtract(
        netDepositAmount,
        totalBorrowedAmount
      );

      const updatedUser = await this.userRepository.save(user);
      logger.info(`Recalculated balances for user: ${normalizedAddress}`);
      return updatedUser;
    } catch (error) {
      logger.error(`Error recalculating user balances: ${error}`);
      throw error;
    }
  }

  /**
   * Get or create user (utility method)
   * @param walletAddress User's wallet address
   * @returns User (existing or newly created)
   */
  async getOrCreateUser(walletAddress: string): Promise<User> {
    const result = await this.createUser({ walletAddress });
    return result.user;
  }
}
