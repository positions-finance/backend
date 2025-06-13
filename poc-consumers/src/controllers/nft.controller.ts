import { Request, Response } from "express";
import { NftMintingService, MintRequest } from "@/services/NftMintingService";
import { MerkleService } from "@/services/MerkleService";
import logger from "@/utils/logger";

export class NftController {
  private nftMintingService: NftMintingService;
  private merkleService: MerkleService;

  constructor() {
    this.nftMintingService = new NftMintingService();
    this.merkleService = new MerkleService();
  }

  /**
   * Mint an NFT for a user
   * @route POST /mint
   */
  public mintNft = async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress, chainId } = req.body;

      if (!walletAddress) {
        res.status(400).json({
          success: false,
          error: "walletAddress is required",
        });
        return;
      }

      const mintRequest: MintRequest = {
        walletAddress,
        chainId,
      };

      const result = await this.nftMintingService.mintNft(mintRequest);

      if (result.success) {
        logger.info(
          `NFT minted successfully for ${walletAddress}: ${result.tokenId}`
        );
        res.status(200).json({
          success: true,
          message: "NFT minted successfully",
          data: {
            tokenId: result.tokenId,
            transactionHash: result.transactionHash,
            walletAddress,
          },
        });
      } else {
        logger.warn(`NFT minting failed for ${walletAddress}: ${result.error}`);
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error: any) {
      logger.error(`Error in mintNft controller: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  /**
   * Check if a user already has an NFT
   * First checks poc_nfts table, then checks nft_transfers table
   * @route GET /mint/check/:walletAddress
   */
  public checkUserNft = async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        res.status(400).json({
          success: false,
          error: "walletAddress is required",
        });
        return;
      }

      const { hasNft: hasMintedNft, nft: mintedTokenId } =
        await this.nftMintingService.userHasNft(walletAddress);

      if (hasMintedNft) {
        res.status(200).json({
          success: true,
          data: {
            walletAddress,
            hasNft: true,
            tokenId: mintedTokenId,
            source: "poc_nfts",
          },
        });
        return;
      }

      logger.info(
        `No minted NFT found for ${walletAddress}, checking transfer records...`
      );

      const ownedTokenIds = await this.merkleService.getOwnedNfts(
        walletAddress
      );

      if (ownedTokenIds.length > 0) {
        res.status(200).json({
          success: true,
          data: {
            walletAddress,
            hasNft: true,
            tokenId: ownedTokenIds[0],
            tokenIds: ownedTokenIds,
            count: ownedTokenIds.length,
            source: "nft_transfers",
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          walletAddress,
          hasNft: false,
          tokenId: null,
          source: null,
        },
      });
    } catch (error: any) {
      logger.error(`Error in checkUserNft controller: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  /**
   * Get NFT contract information
   * @route GET /mint/contract-info
   */
  public getContractInfo = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const contractInfo = await this.nftMintingService.getContractInfo();

      res.status(200).json({
        success: true,
        data: contractInfo,
      });
    } catch (error: any) {
      logger.error(`Error in getContractInfo controller: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  /**
   * Get Merkle proof for NFT ownership
   * @route GET /getMerkleProof?owner=<address>&tokenId=<id>
   */
  public getMerkleProof = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { owner, tokenId } = req.query;

      if (!owner || !tokenId) {
        res.status(400).json({
          success: false,
          error: "Both owner and tokenId are required as query parameters",
        });
        return;
      }

      if (typeof owner !== "string" || typeof tokenId !== "string") {
        res.status(400).json({
          success: false,
          error: "owner and tokenId must be strings",
        });
        return;
      }

      logger.info(
        `Getting Merkle proof for owner: ${owner}, tokenId: ${tokenId}`
      );

      const merkleProof = await this.merkleService.getMerkleProof(
        owner,
        tokenId
      );

      if (!merkleProof) {
        res.status(404).json({
          success: false,
          error: "No valid Merkle proof found for the given owner and tokenId",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          owner,
          tokenId,
          proof: merkleProof.proof,
          root: merkleProof.root,
          verified: merkleProof.verified,
        },
      });
    } catch (error: any) {
      logger.error(`Error in getMerkleProof controller: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  /**
   * Get all NFTs owned by a specific address
   * @route GET /owned/:walletAddress
   */
  public getOwnedNfts = async (req: Request, res: Response): Promise<void> => {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        res.status(400).json({
          success: false,
          error: "walletAddress is required",
        });
        return;
      }

      logger.info(`Getting owned NFTs for address: ${walletAddress}`);

      const ownedTokenIds = await this.merkleService.getOwnedNfts(
        walletAddress
      );

      res.status(200).json({
        success: true,
        data: {
          owner: walletAddress,
          tokenIds: ownedTokenIds,
          count: ownedTokenIds.length,
        },
      });
    } catch (error: any) {
      logger.error(`Error in getOwnedNfts controller: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };
}
