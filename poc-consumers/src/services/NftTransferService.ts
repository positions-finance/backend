import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { ethers } from "ethers";
import { Repository } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { NftTransfer } from "@/models/NftTransfer";
import { User } from "@/models/User";
import logger from "@/utils/logger";
import {
  SUPPORTED_CHAINS,
  PRIVATE_KEY,
  TRANSFER_EVENT_TOPIC,
  RELAYER_ABI,
} from "@/config/contracts";

export class NftTransferService {
  private nftTransferRepository: Repository<NftTransfer>;
  private userRepository: Repository<User>;
  private provider: ethers.JsonRpcProvider;
  private autoGenerateMerkle: boolean = true;

  constructor(autoGenerateMerkle: boolean = true) {
    this.nftTransferRepository = AppDataSource.getRepository(NftTransfer);
    this.userRepository = AppDataSource.getRepository(User);
    this.autoGenerateMerkle = autoGenerateMerkle;

    const chain = SUPPORTED_CHAINS[0];
    if (chain.httpsRpcUrl) {
      this.provider = new ethers.JsonRpcProvider(chain.httpsRpcUrl);
    }
  }

  /**
   * Process transaction data to extract NFT transfers
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

      if (!chain.nftContractAddress) {
        logger.debug(
          `Skipping transaction - no NFT contract configured for chain: ${chain.chainName}`
        );
        return;
      }

      if (!transaction.logs || transaction.logs.length === 0) {
        logger.debug(`Transaction has no logs: ${transaction.hash}`);
        return;
      }

      for (const log of transaction.logs) {
        if (
          log.address.toLowerCase() !== chain.nftContractAddress.toLowerCase()
        ) {
          continue;
        }

        if (!log.topics || log.topics[0] !== TRANSFER_EVENT_TOPIC) {
          continue;
        }

        await this.processTransferEvent(log, transaction, chain);
      }
    } catch (error) {
      logger.error(`Failed to process transaction: ${error}`);
      throw error;
    }
  }

  /**
   * Process an ERC721 Transfer event log
   */
  private async processTransferEvent(
    log: any,
    transaction: any,
    chain: any
  ): Promise<void> {
    try {
      if (log.topics.length !== 4) {
        logger.debug("Not a standard ERC721 transfer (expected 4 topics)");
        return;
      }

      // Topics[1] = from address (padded to 32 bytes)
      // Topics[2] = to address (padded to 32 bytes)
      // Topics[3] = token ID (uint256)
      const fromAddress = ethers.getAddress("0x" + log.topics[1].slice(26));
      const toAddress = ethers.getAddress("0x" + log.topics[2].slice(26));
      const tokenId = ethers.toBigInt(log.topics[3]);

      logger.info(
        `Detected NFT Transfer: TokenID ${tokenId} from ${fromAddress} to ${toAddress}`
      );

      const existing = await this.nftTransferRepository.findOne({
        where: {
          transactionHash: transaction.hash,
        },
      });

      if (existing) {
        logger.debug(
          `NFT transfer already processed, skipping: ${transaction.hash}`
        );
        return;
      }

      if (fromAddress !== "0x0000000000000000000000000000000000000000") {
        await this.getOrCreateUser(fromAddress);
      }
      if (toAddress !== "0x0000000000000000000000000000000000000000") {
        await this.getOrCreateUser(toAddress);
      }

      const nftTransfer = new NftTransfer();
      nftTransfer.chainId = transaction.chainId;
      nftTransfer.chainName = chain.chainName;
      nftTransfer.transactionHash = transaction.hash;
      nftTransfer.blockNumber = transaction.blockNumber;
      nftTransfer.blockHash = transaction.blockHash;
      nftTransfer.tokenAddress = log.address;
      nftTransfer.tokenId = tokenId.toString();
      nftTransfer.fromAddress = fromAddress;
      nftTransfer.toAddress = toAddress;
      nftTransfer.transactionTimestamp =
        transaction.timestamp || Math.floor(Date.now() / 1000);
      nftTransfer.includedInMerkle = false;

      await this.nftTransferRepository.save(nftTransfer);
      logger.info(
        `Saved NFT transfer: ${transaction.hash}, TokenID: ${tokenId}`
      );

      if (this.autoGenerateMerkle) {
        logger.info("Auto-generating Merkle tree for new NFT transfer");
        try {
          await this.processAndSubmitMerkleRoot();
          logger.info(
            "Successfully generated and submitted Merkle root after NFT transfer"
          );
        } catch (error) {
          logger.error(`Failed to auto-generate Merkle tree: ${error}`);
        }
      }
    } catch (error) {
      logger.error(`Error processing transfer event: ${error}`);
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
   * Generate a Merkle tree from NFT ownership data
   */
  async generateMerkleTree(): Promise<string> {
    try {
      logger.info("Generating NFT ownership Merkle tree...");

      const allTransfers = await this.nftTransferRepository.find({
        order: { blockNumber: "ASC" },
      });

      if (allTransfers.length === 0) {
        logger.info("No NFT transfers found");
        return "";
      }

      const newTransfers = await this.nftTransferRepository.find({
        where: { includedInMerkle: false },
        order: { blockNumber: "ASC" },
      });

      if (newTransfers.length === 0) {
        logger.info("No new NFT transfers to process for Merkle tree");
        return "";
      }

      const currentOwnership =
        this.getCurrentOwnershipFromTransfers(allTransfers);
      const leaves = this.createLeavesFromOwnership(currentOwnership);

      if (leaves.length === 0) {
        logger.error("No valid leaves were added to the Merkle Tree");
        return "";
      }

      logger.info(
        `Generated ${leaves.length} leaves from ${
          Object.keys(currentOwnership).length
        } unique tokens (based on all ${allTransfers.length} transfers)`
      );

      const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = merkleTree.getRoot().toString("hex");
      const merkleRoot = `0x${root}`;

      logger.info(`Generated Merkle root: ${merkleRoot}`);

      await this.updateTransfersWithMerkleRoot(newTransfers, merkleRoot);

      return merkleRoot;
    } catch (error) {
      logger.error(`Error generating Merkle tree: ${error}`);
      throw error;
    }
  }

  /**
   * Get current ownership state from transfers (latest transfer per token wins)
   */
  private getCurrentOwnershipFromTransfers(transfers: NftTransfer[]): {
    [tokenId: string]: string;
  } {
    const ownership: { [tokenId: string]: string } = {};

    const sortedTransfers = transfers.sort(
      (a, b) => a.blockNumber - b.blockNumber
    );

    for (const transfer of sortedTransfers) {
      if (transfer.tokenId && transfer.toAddress) {
        ownership[transfer.tokenId] = transfer.toAddress.toLowerCase();
      }
    }

    logger.info(`Current ownership state: ${JSON.stringify(ownership)}`);
    return ownership;
  }

  /**
   * Create Merkle tree leaves from ownership data
   */
  private createLeavesFromOwnership(ownership: {
    [tokenId: string]: string;
  }): Buffer[] {
    return Object.entries(ownership).map(([tokenId, owner]) => {
      const formattedAddress = owner.toLowerCase();
      const encodePacked = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [formattedAddress, tokenId]
      );
      return Buffer.from(encodePacked.slice(2), "hex");
    });
  }

  /**
   * Update transfers with the Merkle root they were included in
   */
  private async updateTransfersWithMerkleRoot(
    transfers: NftTransfer[],
    merkleRoot: string
  ): Promise<void> {
    try {
      for (const transfer of transfers) {
        transfer.includedInMerkle = true;
        transfer.merkleRoot = merkleRoot;
        await this.nftTransferRepository.save(transfer);
      }
      logger.info(
        `Updated ${transfers.length} transfers with Merkle root: ${merkleRoot}`
      );
    } catch (error) {
      logger.error(`Error updating transfers with Merkle root: ${error}`);
      throw error;
    }
  }

  /**
   * Submit the Merkle root to the relayer contract
   */
  async submitMerkleRoot(merkleRoot: string): Promise<void> {
    if (!merkleRoot) {
      logger.info("No Merkle root to submit");
      return;
    }

    if (!PRIVATE_KEY) {
      logger.error("Missing private key for relayer transactions");
      return;
    }

    for (const chain of SUPPORTED_CHAINS) {
      if (!chain.relayerAddress || !chain.httpsRpcUrl) {
        logger.warn(
          `Missing relayer address or RPC URL for ${chain.chainName}, skipping`
        );
        continue;
      }

      try {
        const provider = new ethers.JsonRpcProvider(chain.httpsRpcUrl);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const iface = new ethers.Interface(RELAYER_ABI);

        const relayerContract = new ethers.Contract(
          chain.relayerAddress,
          iface,
          wallet
        );

        logger.info(
          `Submitting Merkle root to ${chain.chainName} relayer: ${merkleRoot}`
        );
        const tx = await relayerContract.updateNFTOwnershipRoot(merkleRoot);
        logger.info(
          `Merkle root update transaction submitted on ${chain.chainName}: ${tx.hash}`
        );

        const receipt = await tx.wait();
        logger.info(
          `Merkle root update confirmed on ${chain.chainName} in block ${receipt.blockNumber}`
        );
      } catch (error) {
        logger.error(
          `Error submitting Merkle root to ${chain.chainName}:`,
          error
        );
      }
    }
  }

  /**
   * Run the full process to generate and submit a new Merkle root
   */
  async processAndSubmitMerkleRoot(): Promise<void> {
    try {
      const merkleRoot = await this.generateMerkleTree();
      if (merkleRoot) {
        await this.submitMerkleRoot(merkleRoot);
      }
    } catch (error) {
      logger.error(`Error in Merkle root processing and submission: ${error}`);
    }
  }

  /**
   * Enable or disable automatic Merkle tree generation
   * @param enabled Whether to enable automatic generation
   */
  setAutoGenerateMerkle(enabled: boolean): void {
    this.autoGenerateMerkle = enabled;
    logger.info(
      `Automatic Merkle generation ${enabled ? "enabled" : "disabled"}`
    );
  }

  /**
   * Check if automatic Merkle tree generation is enabled
   * @returns True if automatic generation is enabled
   */
  isAutoGenerateMerkleEnabled(): boolean {
    return this.autoGenerateMerkle;
  }
}
