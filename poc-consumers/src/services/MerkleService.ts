import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { ethers } from "ethers";
import { Repository, Not, IsNull, LessThanOrEqual } from "typeorm";
import { AppDataSource } from "@/database/data-source";
import { NftTransfer } from "@/models/NftTransfer";
import logger from "@/utils/logger";

/**
 * Service for generating and verifying Merkle proofs for NFT ownership
 */
export class MerkleService {
  private nftTransferRepository: Repository<NftTransfer>;

  constructor() {
    this.nftTransferRepository = AppDataSource.getRepository(NftTransfer);
  }

  /**
   * Get NFT ownership proof for a specific owner and tokenId
   * @param owner The owner's address
   * @param tokenId The token ID
   * @returns The Merkle proof if the ownership is valid
   */
  async getMerkleProof(
    owner: string,
    tokenId: string | number
  ): Promise<{ proof: string[]; root: string; verified: boolean } | null> {
    try {
      const normalizedOwner = owner.toLowerCase();
      const normalizedTokenId =
        typeof tokenId === "string" ? tokenId : tokenId.toString();

      const latestTransfer = await this.nftTransferRepository.findOne({
        where: {
          includedInMerkle: true,
          merkleRoot: Not(IsNull()),
        },
        order: { blockNumber: "DESC" },
      });

      if (!latestTransfer || !latestTransfer.merkleRoot) {
        logger.warn(`No Merkle root available for verification`);
        return null;
      }

      const merkleRoot = latestTransfer.merkleRoot;

      const allTransfers = await this.nftTransferRepository.find({
        where: {
          blockNumber: LessThanOrEqual(latestTransfer.blockNumber),
        },
        order: { blockNumber: "ASC" },
      });

      logger.info(
        `Found ${allTransfers.length} total transfers up to block ${latestTransfer.blockNumber} for merkle root: ${merkleRoot}`
      );

      const currentOwnership =
        this.getCurrentOwnershipFromTransfers(allTransfers);
      const leaves = this.createLeavesFromOwnership(currentOwnership);

      if (leaves.length === 0) {
        logger.error("No valid leaves were found for the Merkle tree");
        return null;
      }

      logger.info(`Generated ${leaves.length} leaves for Merkle tree`);

      const uniqueCombinations = Object.entries(currentOwnership).map(
        ([tokenId, owner]) => `${owner.toLowerCase()}:${tokenId}`
      );
      logger.info(
        `Current owner:tokenId combinations: ${JSON.stringify(
          uniqueCombinations
        )}`
      );

      const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });

      const actualOwner = currentOwnership[normalizedTokenId];
      if (!actualOwner || actualOwner.toLowerCase() !== normalizedOwner) {
        logger.warn(
          `Ownership mismatch for token ${normalizedTokenId}. Requested: ${normalizedOwner}, Actual: ${
            actualOwner || "none"
          }`
        );
        return null;
      }

      const targetLeaf = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [normalizedOwner, normalizedTokenId]
      );
      const targetLeafBuffer = Buffer.from(targetLeaf.slice(2), "hex");

      const proof = merkleTree.getProof(targetLeafBuffer);
      const proofHex = proof.map((p: any) => "0x" + p.data.toString("hex"));

      const verified = merkleTree.verify(
        proof,
        targetLeafBuffer,
        merkleTree.getRoot()
      );

      if (!verified) {
        logger.warn(
          `Could not verify proof for owner ${normalizedOwner} and token ID ${normalizedTokenId}`
        );
        return null;
      }

      return {
        proof: proofHex,
        root: "0x" + merkleTree.getRoot().toString("hex"),
        verified,
      };
    } catch (error) {
      logger.error(`Error getting Merkle proof: ${error}`);
      return null;
    }
  }

  /**
   * Verify if an owner owns a specific NFT using the Merkle proof
   * @param owner The owner's address
   * @param tokenId The token ID
   * @returns True if ownership is verified, false otherwise
   */
  async verifyNftOwnership(
    owner: string,
    tokenId: string | number
  ): Promise<boolean> {
    try {
      const proof = await this.getMerkleProof(owner, tokenId);
      return proof ? proof.verified : false;
    } catch (error) {
      logger.error(`Error verifying NFT ownership: ${error}`);
      return false;
    }
  }

  /**
   * Get all NFTs owned by a specific address
   * @param owner The owner's address
   * @returns Array of owned token IDs
   */
  async getOwnedNfts(owner: string): Promise<string[]> {
    try {
      const normalizedOwner = owner.toLowerCase();

      const query = `
        WITH latest_transfers AS (
          SELECT DISTINCT ON (token_id) 
            token_id, 
            to_address,
            block_number
          FROM nft_transfers
          ORDER BY token_id, block_number DESC, created_at DESC
        )
        SELECT token_id 
        FROM latest_transfers
        WHERE LOWER(to_address) = $1
      `;

      const result = await this.nftTransferRepository.query(query, [
        normalizedOwner,
      ]);

      const ownedTokenIds = result.map((row: any) => row.token_id);

      logger.info(
        `Found ${
          ownedTokenIds.length
        } NFTs owned by ${normalizedOwner}: [${ownedTokenIds.join(", ")}]`
      );

      return ownedTokenIds;
    } catch (error) {
      logger.error(`Error getting owned NFTs: ${error}`);
      return [];
    }
  }

  /**
   * Process NFT transfers to create leaves for MerkleTree
   * Returns array of Buffer leaves for the merkletreejs library
   */
  private processNftTransfersForMerkleTree(transfers: NftTransfer[]): Buffer[] {
    return transfers
      .map((transfer) => {
        if (transfer.tokenId && transfer.toAddress) {
          const formattedAddress = transfer.toAddress.toLowerCase();
          const encodePacked = ethers.solidityPackedKeccak256(
            ["address", "uint256"],
            [formattedAddress, transfer.tokenId]
          );
          return Buffer.from(encodePacked.slice(2), "hex");
        }
        return null;
      })
      .filter((leaf): leaf is Buffer => leaf !== null);
  }

  private getCurrentOwnershipFromTransfers(transfers: NftTransfer[]): {
    [tokenId: string]: string;
  } {
    const ownership: { [tokenId: string]: string } = {};
    for (const transfer of transfers) {
      if (transfer.tokenId && transfer.toAddress) {
        ownership[transfer.tokenId] = transfer.toAddress.toLowerCase();
      }
    }
    return ownership;
  }

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
}
