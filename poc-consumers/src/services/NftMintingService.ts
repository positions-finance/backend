import { ethers } from "ethers";
import { Repository } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { PocNft } from "@/models/PocNft";
import { User } from "@/models/User";
import logger from "@/utils/logger";
import env from "@/config/env";
import { ERC721_ABI } from "@/utils/constants/abi";

export interface MintRequest {
  walletAddress: string;
  chainId?: number;
}

export interface MintResponse {
  success: boolean;
  tokenId?: string;
  transactionHash?: string;
  error?: string;
}

export class NftMintingService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private nftContract: ethers.Contract;
  private pocNftRepository: Repository<PocNft>;
  private userRepository: Repository<User>;

  constructor() {
    this.pocNftRepository = AppDataSource.getRepository(PocNft);
    this.userRepository = AppDataSource.getRepository(User);

    this.provider = new ethers.JsonRpcProvider(
      env.BLOCKCHAIN.BERACHAIN_RPC_URL
    );

    if (!env.BLOCKCHAIN.PRIVATE_KEY) {
      throw new Error("PRIVATE_KEY is required for minting NFTs");
    }
    this.wallet = new ethers.Wallet(env.BLOCKCHAIN.PRIVATE_KEY, this.provider);

    this.nftContract = new ethers.Contract(
      env.BLOCKCHAIN.POSITIONS_NFT_ADDRESS,
      ERC721_ABI,
      this.wallet
    );
  }

  /**
   * Mint an NFT for a user
   */
  async mintNft(request: MintRequest): Promise<MintResponse> {
    try {
      logger.info(`Minting NFT for wallet: ${request.walletAddress}`);

      if (!ethers.isAddress(request.walletAddress)) {
        return {
          success: false,
          error: "Invalid wallet address",
        };
      }

      const existingNft = await this.pocNftRepository.findOne({
        relations: ["user"],
        where: {
          user: {
            walletAddress: request.walletAddress.toLowerCase(),
          },
        },
      });

      if (existingNft) {
        return {
          success: false,
          error: "User already has a minted NFT",
        };
      }

      const contractName = await this.nftContract.name();
      logger.info(`Connected to NFT contract: ${contractName}`);

      logger.info(`Calling mint function for ${request.walletAddress}`);
      const tx = await this.nftContract.mint(request.walletAddress);
      logger.info(`Mint transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();
      logger.info(`Transaction confirmed in block: ${receipt.blockNumber}`);

      const transferEvent = receipt.logs.find((log: any) => {
        try {
          const parsed = this.nftContract.interface.parseLog(log);
          return parsed && parsed.name === "Transfer";
        } catch {
          return false;
        }
      });

      if (!transferEvent) {
        throw new Error("Transfer event not found in transaction receipt");
      }

      const parsedEvent = this.nftContract.interface.parseLog(transferEvent);
      if (!parsedEvent) {
        throw new Error("Failed to parse Transfer event");
      }

      const tokenId = parsedEvent.args.tokenId.toString();

      logger.info(`NFT minted successfully. Token ID: ${tokenId}`);

      await this.saveNftToDatabase(request.walletAddress, tokenId, tx.hash);

      return {
        success: true,
        tokenId,
        transactionHash: tx.hash,
      };
    } catch (error: any) {
      logger.error(`Error minting NFT: ${error.message}`);
      return {
        success: false,
        error: error.message || "Failed to mint NFT",
      };
    }
  }

  /**
   * Save minted NFT information to database
   */
  private async saveNftToDatabase(
    walletAddress: string,
    tokenId: string,
    transactionHash: string
  ): Promise<void> {
    try {
      let user = await this.userRepository.findOne({
        where: { walletAddress: walletAddress.toLowerCase() },
      });

      if (!user) {
        user = new User();
        user.walletAddress = walletAddress.toLowerCase();
        user = await this.userRepository.save(user);
        logger.info(`Created new user: ${user.walletAddress}`);
      }

      const pocNft = new PocNft();
      pocNft.tokenId = tokenId;
      pocNft.tokenAddress = env.BLOCKCHAIN.POSITIONS_NFT_ADDRESS;
      pocNft.chainId = 80094;
      pocNft.chainName = "berachain";
      pocNft.user = user;
      pocNft.acquisitionDate = new Date();
      pocNft.metadata = {
        transactionHash,
        mintedAt: new Date().toISOString(),
      };

      await this.pocNftRepository.save(pocNft);
      logger.info(
        `Saved NFT to database: Token ID ${tokenId} for user ${user.walletAddress}`
      );
    } catch (error) {
      logger.error(`Error saving NFT to database: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a user already has an NFT
   */
  async userHasNft(walletAddress: string): Promise<{
    hasNft: boolean;
    nft: string;
  }> {
    try {
      const existingNft = await this.pocNftRepository.findOne({
        relations: ["user"],
        where: {
          user: {
            walletAddress: walletAddress.toLowerCase(),
          },
        },
      });

      return {
        hasNft: !!existingNft,
        nft: existingNft ? existingNft.tokenId : "",
      };
    } catch (error) {
      logger.error(`Error checking if user has NFT: ${error}`);
      return {
        hasNft: false,
        nft: "",
      };
    }
  }

  /**
   * Get contract information
   */
  async getContractInfo(): Promise<any> {
    try {
      const [name, symbol, totalSupply] = await Promise.all([
        this.nftContract.name(),
        this.nftContract.symbol(),
        this.nftContract.totalSupply().catch(() => "N/A"),
      ]);

      return {
        contractAddress: env.BLOCKCHAIN.POSITIONS_NFT_ADDRESS,
        name,
        symbol,
        totalSupply: totalSupply.toString(),
        chainId: 80094,
        chainName: "berachain",
      };
    } catch (error) {
      logger.error(`Error getting contract info: ${error}`);
      throw error;
    }
  }
}
