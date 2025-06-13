import { ethers } from "ethers";
import { Repository } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { VaultEvent } from "@/models/VaultEvent";
import { User } from "@/models/User";
import { Deposit } from "@/models/Deposit";
import { Withdrawal } from "@/models/Withdrawal";
import { Borrow } from "@/models/Borrow";
import logger from "@/utils/logger";
import { safeAdd, safeSubtract, formatDecimal } from "@/utils/decimal";
import {
  SUPPORTED_CHAINS,
  DEPOSIT_TOPIC,
  WITHDRAW_REQUEST_TOPIC,
  WITHDRAW_TOPIC,
  LENDING_POOL_HANDLER_ABI,
} from "@/config/contracts";

const POSITIONS_VAULTS_ENTRY_POINT_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_handler", type: "address" },
      { internalType: "bytes32", name: "_requestId", type: "bytes32" },
      { internalType: "bytes32[]", name: "_proof", type: "bytes32[]" },
      { internalType: "bytes", name: "_additionalData", type: "bytes" },
    ],
    name: "completeWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
import { PricingService } from "./PricingService";
import { MerkleService } from "./MerkleService";

const EVENT_ABI = [
  "event Deposit(address indexed sender, address indexed asset, address indexed vault, uint256 chainId, uint256 amount, uint256 tokenId)",
  "event WithdrawRequest(bytes32 requestId, address indexed sender, address indexed asset, address indexed vault, uint256 chainId, uint256 amount, uint256 tokenId)",
  "event Withdraw(address indexed sender, address indexed asset, address indexed vault, bytes32 requestId, uint256 chainId, uint256 amount, uint256 tokenId)",
];

export class VaultEventService {
  private vaultEventRepository: Repository<VaultEvent>;
  private userRepository: Repository<User>;
  private depositRepository: Repository<Deposit>;
  private withdrawalRepository: Repository<Withdrawal>;
  private borrowRepository: Repository<Borrow>;
  private pricingService: PricingService;
  private merkleService: MerkleService;
  private providers: Map<number, ethers.JsonRpcProvider>;
  private lendingPoolHandlerContracts: Map<number, ethers.Contract>;
  private positionsVaultsEntryPointContracts: Map<number, ethers.Contract>;
  private iface: ethers.Interface;

  constructor() {
    this.vaultEventRepository = AppDataSource.getRepository(VaultEvent);
    this.userRepository = AppDataSource.getRepository(User);
    this.depositRepository = AppDataSource.getRepository(Deposit);
    this.withdrawalRepository = AppDataSource.getRepository(Withdrawal);
    this.borrowRepository = AppDataSource.getRepository(Borrow);
    this.pricingService = new PricingService();
    this.merkleService = new MerkleService();
    this.providers = new Map();
    this.lendingPoolHandlerContracts = new Map();
    this.positionsVaultsEntryPointContracts = new Map();
    this.iface = new ethers.Interface(EVENT_ABI);

    SUPPORTED_CHAINS.forEach((chain) => {
      if (chain.httpsRpcUrl) {
        const provider = new ethers.JsonRpcProvider(chain.httpsRpcUrl);
        this.providers.set(chain.chainId, provider);

        if (chain.lendingPoolHandlerAddress && process.env.PRIVATE_KEY) {
          try {
            const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            const contract = new ethers.Contract(
              chain.lendingPoolHandlerAddress,
              LENDING_POOL_HANDLER_ABI,
              wallet
            );
            this.lendingPoolHandlerContracts.set(chain.chainId, contract);
            logger.info(
              `Initialized lending pool handler contract for ${chain.chainName}`
            );
          } catch (error) {
            logger.error(
              `Failed to initialize lending pool handler contract for ${chain.chainName}: ${error}`
            );
          }
        }

        if (chain.vaultContractAddress && process.env.PRIVATE_KEY) {
          try {
            const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            const contract = new ethers.Contract(
              chain.vaultContractAddress,
              POSITIONS_VAULTS_ENTRY_POINT_ABI,
              wallet
            );
            this.positionsVaultsEntryPointContracts.set(
              chain.chainId,
              contract
            );
            logger.info(
              `Initialized positions vaults entry point contract for ${chain.chainName}`
            );
          } catch (error) {
            logger.error(
              `Failed to initialize positions vaults entry point contract for ${chain.chainName}: ${error}`
            );
          }
        }
      }
    });
  }

  /**
   * Process a transaction to extract and handle vault events
   */
  async processTransaction(transaction: any): Promise<void> {
    try {
      const chain = SUPPORTED_CHAINS.find(
        (c) => c.chainId === transaction.chainId
      );
      if (!chain) {
        logger.debug(
          `Skipping transaction - not from target chain: ${transaction.chainId}`
        );
        return;
      }

      if (!chain.vaultContractAddress) {
        logger.debug(
          `Skipping transaction - no vault contract configured for chain: ${chain.chainName}`
        );
        return;
      }

      if (!transaction.logs || transaction.logs.length === 0) {
        logger.debug(`Transaction has no logs: ${transaction.hash}`);
        return;
      }

      for (const log of transaction.logs) {
        if (
          log.address.toLowerCase() !== chain.vaultContractAddress.toLowerCase()
        ) {
          continue;
        }

        if (
          log.topics[0] !== DEPOSIT_TOPIC &&
          log.topics[0] !== WITHDRAW_REQUEST_TOPIC &&
          log.topics[0] !== WITHDRAW_TOPIC
        ) {
          continue;
        }

        await this.processVaultEvent(log, transaction, chain);
      }
    } catch (error) {
      logger.error(`Failed to process transaction: ${error}`);
      throw error;
    }
  }

  /**
   * Process a vault event log
   */
  private async processVaultEvent(
    log: any,
    transaction: any,
    chain: any
  ): Promise<void> {
    try {
      const existingEvent = await this.vaultEventRepository.findOne({
        where: {
          transactionHash: transaction.hash,
          chainId: chain.chainId,
          ...(log.logIndex !== undefined && { logIndex: log.logIndex }),
        },
      });

      if (existingEvent) {
        logger.debug(
          `Vault event already processed, skipping: ${transaction.hash}`
        );
        return;
      }

      const eventType = this.getEventType(log.topics[0]);
      if (!eventType) {
        logger.warn(`Unknown event topic: ${log.topics[0]}`);
        return;
      }

      const parsedLog = this.parseEventLog(log, eventType);

      if (!parsedLog) {
        logger.error(`Failed to parse event log: ${JSON.stringify(log)}`);
        return;
      }

      let user = null;
      if (eventType === "deposit") {
        user = await this.getOrCreateUser(parsedLog.sender);
        await this.userRepository.save(user);

        user = await this.userRepository.findOne({
          where: { walletAddress: parsedLog.sender.toLowerCase() },
        });

        if (!user) {
          throw new Error(
            `Failed to find user after creation: ${parsedLog.sender}`
          );
        }

        logger.info(
          `User for deposit: ${user.walletAddress}, current balance: $${user.totalUsdBalance}`
        );
      }

      const usdValue = await this.pricingService.getUsdPrice(
        parsedLog.asset,
        parsedLog.amount,
        chain.chainId
      );

      const vaultEvent = new VaultEvent();
      vaultEvent.blockNumber = transaction.blockNumber;
      vaultEvent.transactionHash = transaction.hash;
      vaultEvent.sender = parsedLog.sender.toLowerCase();
      vaultEvent.asset = parsedLog.asset;
      vaultEvent.vault = parsedLog.vault;
      vaultEvent.chainId = chain.chainId;
      vaultEvent.amount = parsedLog.amount.toString();
      vaultEvent.tokenId = parsedLog.tokenId;
      vaultEvent.requestId = parsedLog.requestId;
      vaultEvent.type = eventType;
      vaultEvent.usdValue = usdValue;

      const timestamp = transaction.timestamp;
      if (timestamp && !isNaN(timestamp) && timestamp > 0) {
        vaultEvent.timestamp = new Date(timestamp * 1000);
      } else {
        vaultEvent.timestamp = new Date();
        logger.warn(
          `Invalid timestamp for transaction ${transaction.hash}, using current time`
        );
      }

      await this.vaultEventRepository.save(vaultEvent);
      logger.info(`Saved vault event: ${transaction.hash}, Type: ${eventType}`);

      if (eventType === "deposit" && user) {
        await this.handleDeposit(vaultEvent, user, chain);
      } else if (eventType === "withdraw_request") {
        const existingUser = await this.userRepository.findOne({
          where: { walletAddress: parsedLog.sender.toLowerCase() },
        });
        if (existingUser) {
          await this.handleWithdrawRequest(vaultEvent, existingUser, chain);
        } else {
          logger.warn(
            `User not found for withdraw request: ${parsedLog.sender}`
          );
        }
      } else if (eventType === "withdraw") {
        const existingUser = await this.userRepository.findOne({
          where: { walletAddress: parsedLog.sender.toLowerCase() },
        });
        if (existingUser) {
          await this.handleWithdraw(vaultEvent, existingUser);
        } else {
          logger.warn(`User not found for withdraw: ${parsedLog.sender}`);
        }
      }
    } catch (error) {
      logger.error(`Error processing vault event: ${error}`);
      throw error;
    }
  }

  /**
   * Determine the event type based on the topic
   */
  private getEventType(topic: string): string | null {
    switch (topic) {
      case DEPOSIT_TOPIC:
        return "deposit";
      case WITHDRAW_REQUEST_TOPIC:
        return "withdraw_request";
      case WITHDRAW_TOPIC:
        return "withdraw";
      default:
        return null;
    }
  }

  /**
   * Parse the event log based on its type
   */
  private parseEventLog(log: any, eventType: string): any {
    try {
      let parsedData;
      switch (eventType) {
        case "deposit":
          const depositSender = ethers
            .getAddress("0x" + log.topics[1].slice(26))
            .toLowerCase();
          const depositAsset = ethers.getAddress(
            "0x" + log.topics[2].slice(26)
          );
          const depositVault = ethers.getAddress(
            "0x" + log.topics[3].slice(26)
          );

          parsedData = this.iface.decodeEventLog(
            "Deposit",
            log.data,
            log.topics
          );
          return {
            sender: depositSender,
            asset: depositAsset,
            vault: depositVault,
            chainId: parsedData.chainId,
            amount: parsedData.amount,
            tokenId: parsedData.tokenId,
          };
        case "withdraw_request":
          const withdrawRequestSender = ethers
            .getAddress("0x" + log.topics[1].slice(26))
            .toLowerCase();
          const withdrawRequestAsset = ethers.getAddress(
            "0x" + log.topics[2].slice(26)
          );
          const withdrawRequestVault = ethers.getAddress(
            "0x" + log.topics[3].slice(26)
          );

          parsedData = this.iface.decodeEventLog(
            "WithdrawRequest",
            log.data,
            log.topics
          );
          return {
            sender: withdrawRequestSender,
            asset: withdrawRequestAsset,
            vault: withdrawRequestVault,
            requestId: parsedData.requestId,
            chainId: parsedData.chainId,
            amount: parsedData.amount,
            tokenId: parsedData.tokenId,
          };
        case "withdraw":
          const withdrawSender = ethers
            .getAddress("0x" + log.topics[1].slice(26))
            .toLowerCase();
          const withdrawAsset = ethers.getAddress(
            "0x" + log.topics[2].slice(26)
          );
          const withdrawVault = ethers.getAddress(
            "0x" + log.topics[3].slice(26)
          );

          parsedData = this.iface.decodeEventLog(
            "Withdraw",
            log.data,
            log.topics
          );
          return {
            sender: withdrawSender,
            asset: withdrawAsset,
            vault: withdrawVault,
            requestId: parsedData.requestId,
            chainId: parsedData.chainId,
            amount: parsedData.amount,
            tokenId: parsedData.tokenId,
          };
        default:
          return null;
      }
    } catch (error) {
      logger.error(`Error parsing event log: ${error}`);
      return null;
    }
  }

  /**
   * Get an existing user or create a new one
   */
  private async getOrCreateUser(walletAddress: string): Promise<User> {
    const normalizedAddress = walletAddress.toLowerCase();
    const existingUser = await this.userRepository.findOne({
      where: { walletAddress: normalizedAddress },
    });

    if (existingUser) {
      return existingUser;
    }

    const newUser = new User();
    newUser.walletAddress = normalizedAddress;
    newUser.totalUsdBalance = 0;
    newUser.floatingUsdBalance = 0;
    newUser.borrowedUsdAmount = 0;

    await this.userRepository.save(newUser);
    logger.info(`Created new user with wallet address: ${normalizedAddress}`);

    return newUser;
  }

  /**
   * Handle a deposit event
   */
  private async handleDeposit(
    vaultEvent: VaultEvent,
    user: User,
    chain: any
  ): Promise<void> {
    try {
      logger.info(
        `Processing deposit for user ${user.walletAddress}, current balance: $${user.totalUsdBalance}, adding: $${vaultEvent.usdValue}`
      );

      const deposit = new Deposit();
      deposit.user = user;
      deposit.chainId = vaultEvent.chainId;
      deposit.chainName = chain.chainName;
      deposit.amount = vaultEvent.amount.toString();
      deposit.tokenAddress = vaultEvent.asset;
      deposit.tokenSymbol = ""; // We would need a token info service to get actual symbols
      deposit.tokenDecimals = 18; // Default decimals, would need token info service
      deposit.transactionHash = vaultEvent.transactionHash;
      deposit.blockNumber = vaultEvent.blockNumber;
      deposit.usdValueAtDeposit = vaultEvent.usdValue;
      deposit.status = "confirmed";

      await this.depositRepository.save(deposit);
      logger.info(`Saved deposit record for user ${user.walletAddress}`);

      const previousTotalBalance = user.totalUsdBalance;
      const previousFloatingBalance = user.floatingUsdBalance;

      user.totalUsdBalance = formatDecimal(
        safeAdd(Number(user.totalUsdBalance), Number(vaultEvent.usdValue))
      );
      user.floatingUsdBalance = formatDecimal(
        safeAdd(Number(user.floatingUsdBalance), Number(vaultEvent.usdValue))
      );

      logger.info(
        `Updating user ${user.walletAddress} balance: total ${previousTotalBalance} -> ${user.totalUsdBalance}, floating ${previousFloatingBalance} -> ${user.floatingUsdBalance}`
      );

      await this.userRepository.save(user);

      logger.info(
        `Successfully processed deposit for user ${user.walletAddress}, added $${vaultEvent.usdValue} to balance. New total: $${user.totalUsdBalance}`
      );
    } catch (error) {
      logger.error(`Error handling deposit: ${error}`);
      throw error;
    }
  }

  /**
   * Handle a withdraw request event
   */
  private async handleWithdrawRequest(
    vaultEvent: VaultEvent,
    user: User,
    chain: any
  ): Promise<void> {
    try {
      const isValid = await this.validateWithdrawal(user, vaultEvent);

      const withdrawal = new Withdrawal();
      withdrawal.user = user;
      withdrawal.chainId = vaultEvent.chainId;
      withdrawal.chainName = chain.chainName;
      withdrawal.amount = vaultEvent.amount.toString();
      withdrawal.tokenAddress = vaultEvent.asset;
      withdrawal.tokenSymbol = ""; // We would need a token info service to get actual symbols
      withdrawal.tokenDecimals = 18; // Default decimals, would need token info service
      withdrawal.transactionHash = vaultEvent.transactionHash;
      withdrawal.blockNumber = vaultEvent.blockNumber;
      withdrawal.usdValueAtWithdrawal = vaultEvent.usdValue;
      withdrawal.status = isValid ? "pending" : "rejected";
      withdrawal.destinationAddress = user.walletAddress;
      withdrawal.requestId = vaultEvent.requestId;

      await this.withdrawalRepository.save(withdrawal);

      if (isValid) {
        user.floatingUsdBalance = formatDecimal(
          safeSubtract(
            Number(user.floatingUsdBalance),
            Number(vaultEvent.usdValue)
          )
        );
        await this.userRepository.save(user);

        await this.callCompleteWithdraw(vaultEvent, user, chain);

        logger.info(
          `Processed valid withdrawal request for user ${user.walletAddress}, requestId: ${vaultEvent.requestId}, reserved $${vaultEvent.usdValue}`
        );
      } else {
        logger.warn(
          `Rejected withdrawal request for user ${user.walletAddress}, requestId: ${vaultEvent.requestId} - insufficient balance`
        );
      }
    } catch (error) {
      logger.error(`Error handling withdraw request: ${error}`);
      throw error;
    }
  }

  /**
   * Handle a completed withdrawal event
   */
  private async handleWithdraw(
    vaultEvent: VaultEvent,
    user: User
  ): Promise<void> {
    try {
      const pendingWithdrawal = await this.withdrawalRepository.findOne({
        where: {
          requestId: vaultEvent.requestId,
          status: "pending",
        },
      });

      if (pendingWithdrawal) {
        pendingWithdrawal.status = "completed";
        await this.withdrawalRepository.save(pendingWithdrawal);

        user.totalUsdBalance = formatDecimal(
          safeSubtract(
            Number(user.totalUsdBalance),
            Number(vaultEvent.usdValue)
          )
        );
        await this.userRepository.save(user);

        logger.info(
          `Completed withdrawal for user ${user.walletAddress}, requestId: ${vaultEvent.requestId}, reduced total balance by $${vaultEvent.usdValue}`
        );
      } else {
        logger.warn(
          `No withdrawal found with requestId: ${vaultEvent.requestId}, trying to find by user, amount and asset`
        );

        const pendingWithdrawals = await this.withdrawalRepository.find({
          where: {
            user: { id: user.id },
            status: "pending",
          },
        });

        const matchingWithdrawal = pendingWithdrawals.find(
          (w) =>
            w.tokenAddress === vaultEvent.asset &&
            w.amount === vaultEvent.amount.toString()
        );

        if (matchingWithdrawal) {
          matchingWithdrawal.status = "completed";
          matchingWithdrawal.requestId = vaultEvent.requestId;
          await this.withdrawalRepository.save(matchingWithdrawal);

          // Now update the total balance since the withdrawal is actually completed
          user.totalUsdBalance = formatDecimal(
            safeSubtract(
              Number(user.totalUsdBalance),
              Number(vaultEvent.usdValue)
            )
          );
          await this.userRepository.save(user);

          logger.info(
            `Completed withdrawal for user ${user.walletAddress} found by amount/asset match, updated with requestId: ${vaultEvent.requestId}`
          );
        } else {
          logger.warn(
            `No matching pending withdrawal request found for user ${user.walletAddress}, requestId: ${vaultEvent.requestId}, asset: ${vaultEvent.asset}`
          );
        }
      }
    } catch (error) {
      logger.error(`Error handling withdraw: ${error}`);
      throw error;
    }
  }

  /**
   * Validate if a withdrawal request can be processed
   */
  private async validateWithdrawal(
    user: User,
    vaultEvent: VaultEvent
  ): Promise<boolean> {
    try {
      const totalDeposits = await this.calculateTotalDeposits(user);
      const totalBorrows = await this.calculateTotalBorrows(user);
      const pendingWithdrawals = await this.calculatePendingWithdrawals(user);

      const availableBalance =
        totalDeposits - totalBorrows - pendingWithdrawals;

      const isValid = availableBalance >= Number(vaultEvent.usdValue);

      logger.debug(`Withdrawal validation for ${user.walletAddress}: 
        Total Deposits: $${totalDeposits}
        Total Borrows: $${totalBorrows}
        Pending Withdrawals: $${pendingWithdrawals}
        Available Balance: $${availableBalance}
        Requested Withdrawal: $${vaultEvent.usdValue}
        Valid: ${isValid}`);

      return isValid;
    } catch (error) {
      logger.error(`Error validating withdrawal: ${error}`);
      return false;
    }
  }

  /**
   * Calculate total deposits for a user
   */
  private async calculateTotalDeposits(user: User): Promise<number> {
    const deposits = await this.depositRepository.find({
      where: { user: { id: user.id } },
    });

    return deposits.reduce(
      (sum, deposit) => sum + Number(deposit.usdValueAtDeposit),
      0
    );
  }

  /**
   * Calculate total borrows for a user
   */
  private async calculateTotalBorrows(user: User): Promise<number> {
    const borrows = await this.borrowRepository.find({
      where: { user: { id: user.id } },
    });

    return borrows.reduce(
      (sum, borrow) => sum + Number(borrow.borrowedUsdAmount || 0),
      0
    );
  }

  /**
   * Calculate pending withdrawals for a user
   */
  private async calculatePendingWithdrawals(user: User): Promise<number> {
    const pendingWithdrawals = await this.withdrawalRepository.find({
      where: {
        user: { id: user.id },
        status: "pending",
      },
    });

    return pendingWithdrawals.reduce(
      (sum, withdrawal) => sum + Number(withdrawal.usdValueAtWithdrawal),
      0
    );
  }

  /**
   * Get the status of a withdrawal request by request ID
   * @param requestId The request ID
   * @returns The withdrawal request details or null if not found
   */
  async getWithdrawalRequestStatus(requestId: string): Promise<any> {
    try {
      const request = await this.withdrawalRepository.findOne({
        where: { requestId },
        relations: ["user"],
      });

      if (!request) {
        logger.warn(`No withdrawal request found with ID: ${requestId}`);
        return null;
      }

      return {
        requestId,
        status: request.status,
        amount: request.amount,
        usdValue: request.usdValueAtWithdrawal,
        asset: request.tokenAddress,
        walletAddress: request.user.walletAddress,
        chainId: request.chainId,
      };
    } catch (error) {
      logger.error(`Error getting withdrawal request status: ${error}`);
      return null;
    }
  }

  /**
   * Get all withdrawal requests for a user
   * @param walletAddress The user's wallet address
   * @param status Optional status filter (pending, completed, rejected)
   * @returns Array of withdrawal requests
   */
  async getUserWithdrawalRequests(
    walletAddress: string,
    status?: string
  ): Promise<any[]> {
    try {
      const normalizedAddress = walletAddress.toLowerCase();

      const user = await this.userRepository.findOne({
        where: { walletAddress: normalizedAddress },
      });

      if (!user) {
        logger.warn(`No user found with wallet address: ${normalizedAddress}`);
        return [];
      }

      const queryConditions: any = { user: { id: user.id } };
      if (status) {
        queryConditions.status = status;
      }

      const withdrawals = await this.withdrawalRepository.find({
        where: queryConditions,
      });

      return withdrawals.map((withdrawal) => ({
        requestId: withdrawal.requestId,
        status: withdrawal.status,
        amount: withdrawal.amount,
        usdValue: withdrawal.usdValueAtWithdrawal,
        asset: withdrawal.tokenAddress,
        chainId: withdrawal.chainId,
        transactionHash: withdrawal.transactionHash,
      }));
    } catch (error) {
      logger.error(`Error getting user withdrawal requests: ${error}`);
      return [];
    }
  }

  /**
   * Get merkle proof for withdrawal
   * If proof isn't available but root is available, return [<root>]
   */
  private async getMerkleProofForWithdrawal(
    vaultEvent: VaultEvent
  ): Promise<string[]> {
    try {
      const userAddress = vaultEvent.sender;
      const tokenId = vaultEvent.tokenId;

      if (!tokenId) {
        logger.warn(
          `No tokenId found in vault event for withdrawal: ${vaultEvent.requestId}`
        );
        return [];
      }

      logger.info(
        `Getting merkle proof for withdrawal - user: ${userAddress}, tokenId: ${tokenId}, requestId: ${vaultEvent.requestId}`
      );
      const merkleResult = await this.merkleService.getMerkleProof(
        userAddress,
        tokenId
      );

      if (!merkleResult) {
        logger.warn(
          `No merkle proof available for user ${userAddress}, tokenId ${tokenId}`
        );
        return [];
      }

      if (!merkleResult.verified) {
        logger.warn(
          `Merkle proof verification failed for user ${userAddress}, tokenId ${tokenId}`
        );
        return [];
      }

      if (merkleResult.proof && merkleResult.proof.length > 0) {
        logger.info(
          `Found valid merkle proof for user ${userAddress}, tokenId ${tokenId}: ${merkleResult.proof.length} elements`
        );
        return merkleResult.proof;
      }

      if (merkleResult.root) {
        logger.info(
          `No proof available but root exists for user ${userAddress}, tokenId ${tokenId}, returning [root]: ${merkleResult.root}`
        );
        return [merkleResult.root];
      }

      logger.warn(
        `No proof or root available for user ${userAddress}, tokenId ${tokenId}`
      );
      return [];
    } catch (error) {
      logger.error(`Error getting merkle proof for withdrawal: ${error}`);
      return [];
    }
  }

  /**
   * Call completeWithdraw on the positions vaults entry point contract
   */
  private async callCompleteWithdraw(
    vaultEvent: VaultEvent,
    user: User,
    chain: any
  ): Promise<void> {
    try {
      const positionsVaultsContract =
        this.positionsVaultsEntryPointContracts.get(chain.chainId);

      if (!positionsVaultsContract) {
        logger.warn(
          `No positions vaults entry point contract available for chain ${chain.chainName}, skipping completeWithdraw call`
        );
        return;
      }

      const handlerAddress = chain.lendingPoolHandlerAddress;
      if (!handlerAddress) {
        logger.warn(
          `No lending pool handler address configured for chain ${chain.chainName}, skipping completeWithdraw call`
        );
        return;
      }

      let requestIdBytes32 = vaultEvent.requestId;
      if (
        !requestIdBytes32.startsWith("0x") ||
        requestIdBytes32.length !== 66
      ) {
        requestIdBytes32 = ethers.zeroPadValue(requestIdBytes32, 32);
      }

      const merkleProof = await this.getMerkleProofForWithdrawal(vaultEvent);

      const additionalData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [vaultEvent.asset]
      );

      logger.info(
        `Calling completeWithdraw for user ${user.walletAddress}, requestId: ${requestIdBytes32}, handler: ${handlerAddress}`
      );

      const tx = await positionsVaultsContract.completeWithdraw(
        handlerAddress,
        requestIdBytes32,
        merkleProof,
        additionalData
      );

      logger.info(`CompleteWithdraw transaction submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      logger.info(
        `CompleteWithdraw transaction confirmed in block ${receipt.blockNumber} for user ${user.walletAddress}`
      );
    } catch (error) {
      logger.error(`Error calling completeWithdraw: ${error}`);
    }
  }
}
