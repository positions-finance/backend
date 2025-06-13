import { ethers } from "ethers";
import { Repository } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { RelayerEvent } from "@/models/RelayerEvent";
import { VaultEvent } from "@/models/VaultEvent";
import { User } from "@/models/User";
import { Borrow } from "@/models/Borrow";
import logger from "@/utils/logger";
import { safeAdd, safeSubtract, formatDecimal } from "@/utils/decimal";
import {
  SUPPORTED_CHAINS,
  COLLATERAL_REQUEST_TOPIC,
  COLLATERAL_PROCESS_TOPIC,
  REPAY_TOPIC,
  TRANSFER_EVENT_TOPIC,
  RELAYER_ABI,
  LENDING_POOL_ABI,
} from "@/config/contracts";
import { PricingService } from "./PricingService";
import { MerkleService } from "./MerkleService";

const EVENT_ABI = [
  "event CollateralRequest(bytes32 indexed requestId, tuple(uint256 tokenId, address protocol, address asset, address sender, uint256 amount, uint256 deadline, bytes data) request, bytes signature)",
  "event CollateralProcess(bytes32 indexed requestId, uint8 status, bytes errorData)",
  "event Repay(address by, uint256 indexed amount, uint256 indexed tokenId)",
];

export class RelayerService {
  private relayerEventRepository: Repository<RelayerEvent>;
  private vaultEventRepository: Repository<VaultEvent>;
  private userRepository: Repository<User>;
  private borrowRepository: Repository<Borrow>;
  private pricingService: PricingService;
  private merkleService: MerkleService;
  private providers: Map<number, ethers.JsonRpcProvider>;
  private relayerContracts: Map<number, ethers.Contract>;
  private iface: ethers.Interface;

  constructor() {
    this.relayerEventRepository = AppDataSource.getRepository(RelayerEvent);
    this.vaultEventRepository = AppDataSource.getRepository(VaultEvent);
    this.userRepository = AppDataSource.getRepository(User);
    this.borrowRepository = AppDataSource.getRepository(Borrow);
    this.pricingService = new PricingService();
    this.merkleService = new MerkleService();
    this.providers = new Map();
    this.relayerContracts = new Map();
    this.iface = new ethers.Interface(EVENT_ABI);

    if (!process.env.PRIVATE_KEY) {
      logger.error("PRIVATE_KEY environment variable is not set");
      return;
    }

    SUPPORTED_CHAINS.forEach((chain) => {
      if (chain.httpsRpcUrl && chain.relayerAddress) {
        const provider = new ethers.JsonRpcProvider(chain.httpsRpcUrl);
        this.providers.set(chain.chainId, provider);

        const wallet = new ethers.Wallet(
          process.env.PRIVATE_KEY || "",
          provider
        );
        const contract = new ethers.Contract(
          chain.relayerAddress,
          RELAYER_ABI,
          wallet
        );
        this.relayerContracts.set(chain.chainId, contract);
      }
    });
  }

  /**
   * Process transaction to extract and handle relayer events
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

      if (!chain.relayerAddress) {
        logger.debug(
          `Skipping transaction - no relayer contract configured for chain: ${chain.chainName}`
        );
        return;
      }

      if (!transaction.logs || transaction.logs.length === 0) {
        logger.debug(`Transaction has no logs: ${transaction.hash}`);
        return;
      }

      for (const log of transaction.logs) {
        if (
          log.topics[0] !== COLLATERAL_REQUEST_TOPIC &&
          log.topics[0] !== COLLATERAL_PROCESS_TOPIC &&
          log.topics[0] !== REPAY_TOPIC
        ) {
          continue;
        }

        await this.processRelayerEvent(log, transaction, chain);
      }
    } catch (error) {
      logger.error(`Failed to process transaction: ${error}`);
      throw error;
    }
  }

  /**
   * Process a relayer event log
   */
  private async processRelayerEvent(
    log: any,
    transaction: any,
    chain: any
  ): Promise<void> {
    try {
      const existingEvent = await this.relayerEventRepository.findOne({
        where: {
          transactionHash: transaction.hash,
          chainId: chain.chainId,
          ...(log.logIndex !== undefined && { logIndex: log.logIndex }),
        },
      });

      if (existingEvent) {
        logger.debug(
          `Relayer event already processed, skipping: ${transaction.hash}`
        );
        return;
      }

      const eventType = this.getEventType(log.topics[0]);
      if (!eventType) {
        logger.warn(`Unknown event topic: ${log.topics[0]}`);
        return;
      }

      const parsedEvent = this.parseEventLog(log, eventType);

      if (!parsedEvent) {
        logger.error(`Failed to parse event log: ${JSON.stringify(log)}`);
        return;
      }

      if (eventType === "collateral_request") {
        await this.handleCollateralRequest(parsedEvent, transaction, chain);
      } else if (eventType === "collateral_process") {
        await this.handleCollateralProcess(parsedEvent, transaction, chain);
      } else if (eventType === "repay") {
        await this.handleRepayEvent(parsedEvent, transaction, chain);
      }
    } catch (error) {
      logger.error(`Error processing relayer event: ${error}`);
      throw error;
    }
  }

  /**
   * Determine the event type based on the topic
   */
  private getEventType(topic: string): string | null {
    switch (topic) {
      case COLLATERAL_REQUEST_TOPIC:
        return "collateral_request";
      case COLLATERAL_PROCESS_TOPIC:
        return "collateral_process";
      case REPAY_TOPIC:
        return "repay";
      default:
        return null;
    }
  }

  /**
   * Parse the event log based on its type
   */
  private parseEventLog(log: any, eventType: string): any {
    try {
      if (eventType === "collateral_request") {
        const requestId = log.topics[1];
        const parsedData = this.iface.decodeEventLog(
          "CollateralRequest",
          log.data,
          log.topics
        );

        const request = parsedData.request;
        const signature = parsedData.signature;

        return {
          requestId,
          tokenId: request.tokenId,
          protocol: request.protocol,
          asset: request.asset,
          sender: request.sender.toLowerCase(),
          amount: request.amount,
          deadline: request.deadline,
          data: request.data,
          signature,
          type: "collateral_request",
        };
      } else if (eventType === "collateral_process") {
        const requestId = log.topics[1];
        const parsedData = this.iface.decodeEventLog(
          "CollateralProcess",
          log.data,
          log.topics
        );

        return {
          requestId,
          status: parsedData.status,
          errorData: parsedData.errorData,
          type: "collateral_process",
        };
      } else if (eventType === "repay") {
        const parsedData = this.iface.decodeEventLog(
          "Repay",
          log.data,
          log.topics
        );

        const repayData = {
          by: parsedData.by.toLowerCase(),
          amount: parsedData.amount,
          type: "repay",
        };

        logger.info(
          `Repay event parsed: User ${
            repayData.by
          }, Amount: ${repayData.amount.toString()}`
        );

        return repayData;
      }

      return null;
    } catch (error) {
      logger.error(`Error parsing event log: ${error}`);
      return null;
    }
  }

  /**
   * Handle a collateral request event
   */
  private async handleCollateralRequest(
    parsedEvent: any,
    transaction: any,
    chain: any
  ): Promise<void> {
    try {
      const user = await this.getOrCreateUser(parsedEvent.sender);

      const relayerEvent = new RelayerEvent();
      relayerEvent.blockNumber = transaction.blockNumber;
      relayerEvent.transactionHash = transaction.hash;
      relayerEvent.requestId = parsedEvent.requestId;
      relayerEvent.tokenId = parsedEvent.tokenId;
      relayerEvent.protocol = parsedEvent.protocol;
      relayerEvent.asset = parsedEvent.asset;
      relayerEvent.sender = parsedEvent.sender;
      relayerEvent.amount = parsedEvent.amount.toString();
      relayerEvent.deadline = Number(parsedEvent.deadline);
      relayerEvent.data = parsedEvent.data;
      relayerEvent.signature = parsedEvent.signature;
      relayerEvent.status = 1; // Pending
      relayerEvent.chainId = chain.chainId;
      relayerEvent.type = "collateral_request";

      const timestamp = transaction.timestamp;
      if (timestamp && !isNaN(timestamp) && timestamp > 0) {
        relayerEvent.timestamp = new Date(timestamp * 1000);
      } else {
        relayerEvent.timestamp = new Date();
        logger.warn(
          `Invalid timestamp for transaction ${transaction.hash}, using current time`
        );
      }

      await this.relayerEventRepository.save(relayerEvent);
      logger.info(
        `Saved collateral request: ${transaction.hash}, RequestId: ${parsedEvent.requestId}`
      );

      await this.validateAndProcessRequest(relayerEvent, chain);
    } catch (error) {
      logger.error(`Error handling collateral request: ${error}`);
      throw error;
    }
  }

  /**
   * Handle a collateral process event
   */
  private async handleCollateralProcess(
    parsedEvent: any,
    transaction: any,
    chain: any
  ): Promise<void> {
    try {
      const request = await this.relayerEventRepository.findOne({
        where: {
          requestId: parsedEvent.requestId,
          chainId: chain.chainId,
          type: "collateral_request",
        },
        relations: ["user"],
      });

      if (!request) {
        logger.warn(
          `No matching collateral request found for requestId: ${parsedEvent.requestId}`
        );
        return;
      }

      request.status = parsedEvent.status;
      request.errorData = parsedEvent.errorData;
      request.processTransactionHash = transaction.hash;

      await this.relayerEventRepository.save(request);
      logger.info(
        `Updated collateral request status: ${parsedEvent.requestId}, Status: ${parsedEvent.status}`
      );

      if (parsedEvent.status == 2) {
        await this.createBorrowRecord(request, transaction, chain);
      }
    } catch (error) {
      logger.error(`Error handling collateral process: ${error}`);
      throw error;
    }
  }

  /**
   * Handle a repay debt event
   */
  private async handleRepayEvent(
    parsedEvent: any,
    transaction: any,
    chain: any
  ): Promise<void> {
    try {
      logger.info(
        `Processing repay event: User ${
          parsedEvent.by
        }, Amount: ${parsedEvent.amount.toString()}`
      );

      const user = await this.getOrCreateUser(parsedEvent.by);

      let assetAddress = null;
      if (transaction.logs && transaction.logs.length > 0) {
        const transferLog = transaction.logs.find(
          (log: any) => log.topics[0] === TRANSFER_EVENT_TOPIC
        );

        if (transferLog) {
          assetAddress = transferLog.address;
          logger.info(
            `Extracted asset address from Transfer event: ${assetAddress}`
          );
        }
      }

      if (!assetAddress) {
        assetAddress = chain.assets?.[0]?.address || "0x0";
        const receipt = (await this.providers
          .get(chain.chainId)
          ?.getTransactionReceipt(transaction.hash)) as any;
        const logs = receipt?.logs;
        const transferLog = logs?.find(
          (log: any) => log.topics[0] === TRANSFER_EVENT_TOPIC
        );
        if (transferLog) {
          assetAddress = transferLog.address;
        } else {
          logger.warn(
            `Could not extract asset from Transfer event, using fallback: ${assetAddress}`
          );
        }
      }

      if (!assetAddress || assetAddress === "0x0") {
        logger.warn(
          `No valid asset found for chain ${chain.chainName}, skipping repay event`
        );
        return;
      }

      const repayAmountInUsd = await this.getAmountInUsd(
        assetAddress,
        parsedEvent.amount.toString(),
        chain.chainId
      );

      logger.info(`Repay amount in USD: $${repayAmountInUsd}`);

      const activeBorrows = await this.borrowRepository.find({
        where: {
          user: { id: user.id },
          status: "active",
        },
        relations: ["user"],
      });

      if (activeBorrows.length === 0) {
        logger.warn(`No active borrows found for user ${parsedEvent.by}`);
        return;
      }

      let totalActiveBorrowAmount = activeBorrows.reduce(
        (sum, borrow) => sum + Number(borrow.borrowedUsdAmount),
        0
      );

      logger.info(
        `Total active borrow amount before repay: $${totalActiveBorrowAmount}`
      );

      const actualRepayAmount = Math.min(
        repayAmountInUsd,
        totalActiveBorrowAmount
      );

      if (actualRepayAmount <= 0) {
        logger.warn(
          `Invalid repay amount: ${actualRepayAmount} for user ${parsedEvent.by}`
        );
        return;
      }

      user.borrowedUsdAmount = formatDecimal(
        Math.max(0, safeSubtract(user.borrowedUsdAmount, actualRepayAmount))
      );
      user.floatingUsdBalance = formatDecimal(
        safeAdd(user.floatingUsdBalance, actualRepayAmount)
      );

      await this.userRepository.save(user);

      let remainingRepayAmount = actualRepayAmount;
      for (const borrow of activeBorrows) {
        if (remainingRepayAmount <= 0) break;

        const borrowAmount = Number(borrow.borrowedUsdAmount);
        if (remainingRepayAmount >= borrowAmount) {
          borrow.status = "repaid";
          borrow.repaymentAmount = formatDecimal(borrowAmount);
          borrow.loanEndDate = new Date();
          remainingRepayAmount -= borrowAmount;
        } else {
          borrow.borrowedUsdAmount = formatDecimal(
            safeSubtract(borrowAmount, remainingRepayAmount)
          );
          borrow.repaymentAmount = formatDecimal(
            safeAdd(borrow.repaymentAmount || 0, remainingRepayAmount)
          );
          remainingRepayAmount = 0;
        }

        await this.borrowRepository.save(borrow);
      }

      logger.info(
        `Repay processed successfully: User ${parsedEvent.by}, Repaid: $${actualRepayAmount}, New borrowed amount: $${user.borrowedUsdAmount}, New floating balance: $${user.floatingUsdBalance}`
      );
    } catch (error) {
      logger.error(`Error handling repay event: ${error}`);
      throw error;
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
   * Validate and process a collateral request
   */
  private async validateAndProcessRequest(
    request: RelayerEvent,
    chain: any
  ): Promise<void> {
    try {
      logger.info(`=== Validating Request ${request.requestId} ===`);
      logger.info(
        `TokenId: ${request.tokenId}, Asset: ${request.asset}, Amount: ${request.amount}`
      );

      const currentTime = Math.floor(Date.now() / 1000);
      if (request.deadline < currentTime) {
        logger.warn(`Request ${request.requestId} has expired`);
        await this.processRequestOnChain(
          request,
          chain,
          false,
          "Request expired"
        );
        return;
      }

      const user = await this.userRepository.findOne({
        where: { walletAddress: request.sender },
      });

      if (!user) {
        logger.warn(`User not found for request ${request.requestId}`);
        await this.processRequestOnChain(
          request,
          chain,
          false,
          "User not found"
        );
        return;
      }

      const isNftVerified = await this.verifyNftOwnership(
        request.sender,
        request.tokenId
      );

      if (!isNftVerified) {
        logger.warn(
          `NFT ownership verification failed for request ${request.requestId}`
        );
        await this.processRequestOnChain(
          request,
          chain,
          false,
          "NFT ownership verification failed"
        );
        return;
      }

      const { totalAssetValue, totalLTV } =
        await this.calculateAssetValueAndLTV(request.tokenId);
      logger.info(
        `TokenId ${request.tokenId}: Total asset value: $${totalAssetValue}, Total LTV: $${totalLTV}`
      );

      const totalUtilization = await this.calculateTotalUtilization(
        request.tokenId,
        chain.chainId
      );
      logger.info(
        `TokenId ${request.tokenId}: Total utilization: $${totalUtilization}`
      );

      const amountInUsd = await this.getAmountInUsd(
        request.asset,
        request.amount,
        chain.chainId
      );
      logger.info(`Request amount in USD: $${amountInUsd}`);

      const isWithinLtvLimit = totalUtilization + amountInUsd <= totalLTV;
      logger.info(
        `LTV Check: ${totalUtilization} + ${amountInUsd} <= ${totalLTV} = ${isWithinLtvLimit}`
      );

      if (!isWithinLtvLimit) {
        logger.warn(`Request ${request.requestId} exceeds LTV limits`);
        logger.warn(
          `Current utilization: $${totalUtilization}, Requested: $${amountInUsd}, Available LTV: $${totalLTV}`
        );
        await this.processRequestOnChain(
          request,
          chain,
          false,
          "Exceeds LTV limits"
        );
        return;
      }

      logger.info(
        `✅ Request ${request.requestId} approved - within LTV limits`
      );
      await this.processRequestOnChain(request, chain, true);
    } catch (error: any) {
      logger.error(`Error validating request ${request.requestId}: ${error}`);
      await this.processRequestOnChain(
        request,
        chain,
        false,
        `Error: ${error.message}`
      );
    }
  }

  /**
   * Process a request on-chain by calling the relayer contract
   */
  private async processRequestOnChain(
    request: RelayerEvent,
    chain: any,
    approval: boolean,
    errorReason?: string
  ): Promise<void> {
    try {
      const relayerContract = this.relayerContracts.get(chain.chainId);

      if (!relayerContract) {
        throw new Error(
          `Relayer contract not found for chain ${chain.chainId}`
        );
      }

      logger.info(
        `Processing request ${request.requestId} on-chain with approval=${approval}`
      );

      const tx = await relayerContract.processRequest(
        request.requestId,
        approval
      );
      logger.info(`Transaction submitted: ${tx.hash}`);

      await tx.wait();
      logger.info(`Transaction confirmed: ${tx.hash}`);

      request.status = approval ? 2 : 3; // 2 = approved, 3 = rejected
      if (!approval && errorReason) {
        request.errorData = errorReason;
      }

      await this.relayerEventRepository.save(request);
    } catch (error) {
      logger.error(`Error processing request on-chain: ${error}`);
      throw error;
    }
  }

  /**
   * Create a borrow record for an approved request
   */
  private async createBorrowRecord(
    request: RelayerEvent,
    transaction: any,
    chain: any
  ): Promise<void> {
    try {
      const user = request.user;
      if (!user) {
        throw new Error(`User not found for request ${request.requestId}`);
      }

      const amountInUsd = await this.getAmountInUsd(
        request.asset,
        request.amount,
        chain.chainId
      );

      const borrow = new Borrow();
      borrow.user = user;
      borrow.borrowedUsdAmount = formatDecimal(amountInUsd);
      borrow.collateralRatio = 0;
      borrow.interestRate = 0;

      const timestamp = transaction.timestamp;
      if (timestamp && !isNaN(timestamp) && timestamp > 0) {
        borrow.loanStartDate = new Date(timestamp * 1000);
      } else {
        borrow.loanStartDate = new Date();
        logger.warn(
          `Invalid timestamp for transaction ${transaction.hash}, using current time for borrow record`
        );
      }

      borrow.status = "active";
      borrow.tokenSentAddress = request.asset;
      borrow.tokenAmount = request.amount;
      borrow.transactionHash = transaction.hash;

      await this.borrowRepository.save(borrow);

      const previousBorrowedAmount = Number(user.borrowedUsdAmount);
      const previousFloatingBalance = Number(user.floatingUsdBalance);

      user.borrowedUsdAmount = formatDecimal(
        safeAdd(previousBorrowedAmount, Number(amountInUsd))
      );
      user.floatingUsdBalance = formatDecimal(
        safeAdd(previousFloatingBalance, Number(amountInUsd))
      );

      await this.userRepository.save(user);

      logger.info(`Created borrow record for user ${user.walletAddress}:`);
      logger.info(`  - Borrowed amount: $${amountInUsd}`);
      logger.info(
        `  - Total borrowed: $${previousBorrowedAmount} → $${user.borrowedUsdAmount}`
      );
      logger.info(
        `  - Floating balance: $${previousFloatingBalance} → $${user.floatingUsdBalance}`
      );
    } catch (error) {
      logger.error(`Error creating borrow record: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate the asset value and LTV for a token ID
   */
  private async calculateAssetValueAndLTV(
    tokenId: number
  ): Promise<{ totalAssetValue: number; totalLTV: number }> {
    let totalAssetValue = 0;
    let totalLTV = 0;

    try {
      logger.info(`=== LTV Calculation Debug for TokenId ${tokenId} ===`);

      // 1. Check asset configuration loading
      const assetLtvMap = new Map<string, number>();
      let totalConfiguredAssets = 0;

      SUPPORTED_CHAINS.forEach((chain) => {
        logger.debug(
          `Checking chain ${chain.chainName} (${chain.chainId}) for asset configurations`
        );

        if (!chain.assets) {
          logger.warn(`Chain ${chain.chainName} has no assets property`);
          return;
        }

        if (!Array.isArray(chain.assets)) {
          logger.warn(
            `Chain ${
              chain.chainName
            } assets is not an array: ${typeof chain.assets}`
          );
          return;
        }

        if (chain.assets.length === 0) {
          logger.warn(`Chain ${chain.chainName} has empty assets array`);
          return;
        }

        logger.debug(
          `Chain ${chain.chainName} has ${chain.assets.length} configured assets`
        );

        chain.assets.forEach((assetConfig, index) => {
          logger.debug(`Asset ${index}: ${JSON.stringify(assetConfig)}`);

          if (!assetConfig.address) {
            logger.warn(
              `Asset ${index} on chain ${chain.chainName} missing address`
            );
            return;
          }

          if (!assetConfig.ltv && assetConfig.ltv !== 0) {
            logger.warn(
              `Asset ${index} on chain ${chain.chainName} missing LTV: ${assetConfig.address}`
            );
            return;
          }

          const normalizedAddress = assetConfig.address.toLowerCase();
          const ltvValue =
            typeof assetConfig.ltv === "string"
              ? parseFloat(assetConfig.ltv) / 100
              : assetConfig.ltv / 100;

          assetLtvMap.set(normalizedAddress, ltvValue);
          totalConfiguredAssets++;

          logger.debug(
            `Configured LTV for ${normalizedAddress}: ${ltvValue * 100}%`
          );
        });
      });

      logger.info(`Total configured assets with LTV: ${totalConfiguredAssets}`);
      logger.debug(
        `Asset LTV Map: ${JSON.stringify(Array.from(assetLtvMap.entries()))}`
      );

      // 2. Check deposit and withdrawal data
      const deposits = await this.vaultEventRepository.find({
        where: { tokenId, type: "deposit" },
      });

      const withdrawals = await this.vaultEventRepository.find({
        where: { tokenId, type: "withdraw" },
      });

      logger.info(
        `Found ${deposits.length} deposits and ${withdrawals.length} withdrawals for tokenId ${tokenId}`
      );

      if (deposits.length > 0) {
        logger.debug("Deposit details:");
        deposits.forEach((deposit, index) => {
          logger.debug(
            `  Deposit ${index}: Asset=${deposit.asset}, Amount=${deposit.amount}, ChainId=${deposit.chainId}, USD=${deposit.usdValue}`
          );
        });
      }

      if (withdrawals.length > 0) {
        logger.debug("Withdrawal details:");
        withdrawals.forEach((withdrawal, index) => {
          logger.debug(
            `  Withdrawal ${index}: Asset=${withdrawal.asset}, Amount=${withdrawal.amount}, ChainId=${withdrawal.chainId}, USD=${withdrawal.usdValue}`
          );
        });
      }

      // 3. Calculate net amounts with detailed logging
      const assetNetAmounts = new Map<string, number>();

      for (const event of deposits) {
        const key = `${event.asset.toLowerCase()}-${event.chainId}`;
        const currentAmount = assetNetAmounts.get(key) || 0;
        const newAmount = currentAmount + Number(event.amount);
        assetNetAmounts.set(key, newAmount);
        logger.debug(
          `Added deposit: ${key} = ${newAmount} (was ${currentAmount}, added ${event.amount})`
        );
      }

      for (const event of withdrawals) {
        const key = `${event.asset.toLowerCase()}-${event.chainId}`;
        const currentAmount = assetNetAmounts.get(key) || 0;
        const newAmount = currentAmount - Number(event.amount);
        assetNetAmounts.set(key, newAmount);
        logger.debug(
          `Subtracted withdrawal: ${key} = ${newAmount} (was ${currentAmount}, subtracted ${event.amount})`
        );
      }

      logger.info(
        `Net asset amounts: ${JSON.stringify(
          Array.from(assetNetAmounts.entries())
        )}`
      );

      // 4. Process each asset with comprehensive checks
      for (const [key, netAmount] of assetNetAmounts.entries()) {
        logger.debug(`Processing asset: ${key} with net amount: ${netAmount}`);

        if (netAmount <= 0) {
          logger.debug(
            `Skipping ${key} - non-positive net amount: ${netAmount}`
          );
          continue;
        }

        const [assetAddress, chainIdStr] = key.split("-");
        const chainId = parseInt(chainIdStr);

        logger.debug(`Asset address: ${assetAddress}, Chain ID: ${chainId}`);

        // Check if this is the specific asset mentioned (0x6969696969696969696969696969696969696969)
        if (assetAddress === "0x6969696969696969696969696969696969696969") {
          logger.info(
            `🔍 FOUND TARGET ASSET: ${assetAddress} with net amount: ${netAmount}`
          );
        }

        // Get USD value
        const usdValue = await this.pricingService.getUsdPrice(
          assetAddress,
          netAmount,
          chainId
        );

        logger.debug(`USD value for ${assetAddress}: $${usdValue}`);
        totalAssetValue += usdValue;

        // Check LTV configuration
        const ltv = assetLtvMap.get(assetAddress);
        logger.debug(
          `LTV lookup for ${assetAddress}: ${
            ltv ? ltv * 100 + "%" : "NOT FOUND"
          }`
        );

        if (ltv) {
          const ltvAmount = ltv * usdValue;
          totalLTV += ltvAmount;
          logger.info(
            `✅ Applied LTV for ${assetAddress}: ${
              ltv * 100
            }% of $${usdValue} = $${ltvAmount}`
          );
        } else {
          logger.warn(
            `❌ NO LTV CONFIGURED for asset ${assetAddress} (USD value: $${usdValue})`
          );

          // Additional debugging for the specific asset
          if (assetAddress === "0x6969696969696969696969696969696969696969") {
            logger.error(
              `🚨 CRITICAL: Target asset ${assetAddress} has NO LTV configuration!`
            );
            logger.error(
              `Available LTV configurations: ${JSON.stringify(
                Array.from(assetLtvMap.keys())
              )}`
            );

            // Check if there's a case mismatch or similar address
            const similarAddresses = Array.from(assetLtvMap.keys()).filter(
              (addr) =>
                addr.includes("6969") ||
                assetAddress.includes(addr.substring(2, 8))
            );
            if (similarAddresses.length > 0) {
              logger.error(
                `Similar addresses found in LTV config: ${JSON.stringify(
                  similarAddresses
                )}`
              );
            }
          }
        }
      }

      logger.info(`=== LTV Calculation Results for TokenId ${tokenId} ===`);
      logger.info(`Total Asset Value: $${totalAssetValue}`);
      logger.info(`Total LTV: $${totalLTV}`);
      logger.info(
        `LTV Ratio: ${
          totalAssetValue > 0
            ? ((totalLTV / totalAssetValue) * 100).toFixed(2) + "%"
            : "N/A"
        }`
      );

      // Final validation checks
      if (totalAssetValue > 0 && totalLTV === 0) {
        logger.error(
          `🚨 ISSUE DETECTED: Assets have value ($${totalAssetValue}) but LTV is $0`
        );
        logger.error(
          `This indicates missing or incorrect LTV configurations for deposited assets`
        );
      }

      return { totalAssetValue, totalLTV };
    } catch (error: any) {
      logger.error(`Error calculating asset value and LTV: ${error}`);
      logger.error(`Stack trace: ${error.stack}`);
      return { totalAssetValue: 0, totalLTV: 0 };
    }
  }

  /**
   * Calculate total utilization for a token ID
   */
  private async calculateTotalUtilization(
    tokenId: number,
    chainId: number
  ): Promise<number> {
    try {
      const approvedRequests = await this.relayerEventRepository.find({
        where: {
          tokenId,
          status: 2, // Approved
          type: "collateral_request",
        },
      });

      let totalUtilization = 0;
      const seenProtocols = new Set<string>();

      for (const request of approvedRequests) {
        if (request.protocol) {
          seenProtocols.add(request.protocol.toLowerCase());
        }
      }

      for (const protocol of seenProtocols) {
        try {
          const provider = this.providers.get(chainId);
          if (!provider) continue;

          const protocolContract = new ethers.Contract(
            protocol,
            LENDING_POOL_ABI,
            provider
          );

          const utilization = await protocolContract.utilization(tokenId);
          totalUtilization += Number(utilization) / 1_000_000;
        } catch (error) {
          logger.warn(
            `Error getting utilization from protocol ${protocol}: ${error}`
          );
        }
      }

      return totalUtilization;
    } catch (error) {
      logger.error(`Error calculating total utilization: ${error}`);
      return 0;
    }
  }

  /**
   * Get the USD value of an amount of tokens
   */
  private async getAmountInUsd(
    tokenAddress: string,
    amount: string,
    chainId: number
  ): Promise<number> {
    try {
      return await this.pricingService.getUsdPrice(
        tokenAddress,
        amount,
        chainId
      );
    } catch (error) {
      logger.error(`Error getting USD price: ${error}`);
      return 0;
    }
  }

  /**
   * Verify that the user owns the NFT using the MerkleService
   */
  private async verifyNftOwnership(
    userAddress: string,
    tokenId: number
  ): Promise<boolean> {
    try {
      const normalizedAddress = userAddress.toLowerCase();
      const isVerified = await this.merkleService.verifyNftOwnership(
        normalizedAddress,
        tokenId
      );

      if (isVerified) {
        logger.info(
          `Verified NFT ownership for user ${normalizedAddress}, tokenId ${tokenId} using Merkle proof`
        );
        return true;
      }

      const deposits = await this.vaultEventRepository.find({
        where: {
          sender: normalizedAddress,
          tokenId,
          type: "deposit",
        },
      });

      const hasDeposits = deposits.length > 0;
      if (hasDeposits) {
        logger.info(
          `Verified NFT ownership for user ${normalizedAddress}, tokenId ${tokenId} using deposit history`
        );
      } else {
        logger.warn(
          `Could not verify NFT ownership for user ${normalizedAddress}, tokenId ${tokenId}`
        );
      }

      return hasDeposits;
    } catch (error) {
      logger.error(`Error verifying NFT ownership: ${error}`);
      return false;
    }
  }

  /**
   * Get Merkle proof for a user's NFT ownership
   */
  async getMerkleProof(userAddress: string, tokenId: number): Promise<any> {
    try {
      const normalizedAddress = userAddress.toLowerCase();
      return await this.merkleService.getMerkleProof(
        normalizedAddress,
        tokenId
      );
    } catch (error) {
      logger.error(`Error getting Merkle proof: ${error}`);
      return null;
    }
  }

  /**
   * Process pending requests that have not been handled yet
   */
  async processPendingRequests(): Promise<void> {
    try {
      const pendingRequests = await this.relayerEventRepository.find({
        where: { status: 1, type: "collateral_request" },
        relations: ["user"],
      });

      if (pendingRequests.length === 0) {
        logger.debug("No pending requests to process");
        return;
      }

      logger.info(`Processing ${pendingRequests.length} pending requests`);

      for (const request of pendingRequests) {
        const chain = SUPPORTED_CHAINS.find(
          (c) => c.chainId === request.chainId
        );
        if (!chain) {
          logger.warn(`Chain not found for request ${request.requestId}`);
          continue;
        }

        await this.validateAndProcessRequest(request, chain);
      }
    } catch (error) {
      logger.error(`Error processing pending requests: ${error}`);
    }
  }

  /**
   * Get all relayer events for a user
   */
  async getUserRelayerEvents(
    walletAddress: string,
    status?: number
  ): Promise<any[]> {
    try {
      const normalizedAddress = walletAddress.toLowerCase();

      const queryConditions: any = { sender: normalizedAddress };
      if (status !== undefined) {
        queryConditions.status = status;
      }

      const events = await this.relayerEventRepository.find({
        where: queryConditions,
        order: { timestamp: "DESC" },
      });

      return events.map((event) => ({
        requestId: event.requestId,
        status: event.status,
        tokenId: event.tokenId,
        protocol: event.protocol,
        asset: event.asset,
        amount: event.amount,
        timestamp: event.timestamp,
        chainId: event.chainId,
        transactionHash: event.transactionHash,
        processTransactionHash: event.processTransactionHash,
      }));
    } catch (error) {
      logger.error(`Error getting user relayer events: ${error}`);
      return [];
    }
  }
}
