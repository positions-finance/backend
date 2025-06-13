import { LessThan, MoreThanOrEqual, Repository, In } from "typeorm";
import {
  UnprocessedBlock,
  BlockProcessingStatus,
} from "../entities/UnprocessedBlock.entity";
import { Block } from "ethers";
import logger from "../utils/logger";
import { BlockchainProvider } from "../utils/types/blockchain.types";

export class UnprocessedBlocksService {
  private readonly MAX_RETRIES = 5;
  private readonly REORG_DEPTH = 10;
  constructor(
    private repository: Repository<UnprocessedBlock>,
    private provider: BlockchainProvider
  ) {}

  /**
   * Add a new block to be processed
   */
  async addBlock(chainId: number, block: Block): Promise<UnprocessedBlock> {
    const existingBlock = await this.repository.findOne({
      where: {
        chainId,
        blockNumber: block.number,
      },
    });

    if (existingBlock) {
      if (existingBlock.blockHash !== block.hash) {
        existingBlock.status = BlockProcessingStatus.REORGED;
        existingBlock.errorMessage = "Block hash mismatch - possible reorg";
        await this.repository.save(existingBlock);

        return this.createNewBlockEntry(chainId, block);
      }
      return existingBlock;
    }

    return this.createNewBlockEntry(chainId, block);
  }

  /**
   * Add multiple blocks in batch
   */
  async addBlocks(
    chainId: number,
    blocks: Block[]
  ): Promise<UnprocessedBlock[]> {
    if (blocks.length === 0) {
      return [];
    }

    // Check for existing blocks in batch
    const blockNumbers = blocks.map((b) => b.number);
    const existingBlocks = await this.repository.find({
      where: {
        chainId,
        blockNumber: In(blockNumbers),
      },
    });

    const existingBlockMap = new Map(
      existingBlocks.map((b) => [b.blockNumber, b])
    );

    const blocksToCreate: Block[] = [];
    const blocksToUpdate: UnprocessedBlock[] = [];
    const resultBlocks: UnprocessedBlock[] = [];

    for (const block of blocks) {
      const existing = existingBlockMap.get(block.number);

      if (existing) {
        if (existing.blockHash !== block.hash) {
          existing.status = BlockProcessingStatus.REORGED;
          existing.errorMessage = "Block hash mismatch - possible reorg";
          blocksToUpdate.push(existing);
          blocksToCreate.push(block);
        } else {
          resultBlocks.push(existing);
        }
      } else {
        blocksToCreate.push(block);
      }
    }

    // Update existing blocks that need reorg status
    if (blocksToUpdate.length > 0) {
      await this.repository.save(blocksToUpdate);
    }

    // Create new blocks
    if (blocksToCreate.length > 0) {
      const newBlocks = blocksToCreate.map((block) => {
        const newBlock = new UnprocessedBlock();
        newBlock.chainId = chainId;
        newBlock.blockNumber = block.number;
        newBlock.blockHash = block.hash ?? "";
        newBlock.parentHash = block.parentHash;
        newBlock.status = BlockProcessingStatus.PENDING;
        newBlock.retryCount = 0;
        newBlock.blockData = block;
        return newBlock;
      });

      const savedBlocks = await this.repository.save(newBlocks);
      resultBlocks.push(...savedBlocks);
    }

    logger.debug("Added unprocessed blocks in batch", {
      chainId,
      total: blocks.length,
      created: blocksToCreate.length,
      updated: blocksToUpdate.length,
    });

    return resultBlocks;
  }

  /**
   * Get blocks that need processing
   */
  async getBlocksToProcess(
    chainId: number,
    limit: number = 10
  ): Promise<UnprocessedBlock[]> {
    return this.repository.find({
      where: {
        chainId,
        status: BlockProcessingStatus.PENDING,
        retryCount: LessThan(this.MAX_RETRIES),
      },
      order: {
        blockNumber: "ASC",
      },
      take: limit,
    });
  }

  /**
   * Mark a block as being processed
   */
  async markAsProcessing(block: UnprocessedBlock): Promise<void> {
    block.status = BlockProcessingStatus.PROCESSING;
    await this.repository.save(block);
  }

  /**
   * Mark multiple blocks as being processed
   */
  async markAsProcessingBatch(blocks: UnprocessedBlock[]): Promise<void> {
    if (blocks.length === 0) {
      return;
    }

    blocks.forEach((block) => {
      block.status = BlockProcessingStatus.PROCESSING;
    });

    await this.repository.save(blocks);
  }

  /**
   * Mark a block as completed
   */
  async markAsCompleted(block: UnprocessedBlock): Promise<void> {
    block.status = BlockProcessingStatus.COMPLETED;
    block.processedAt = new Date();
    await this.repository.save(block);
  }

  /**
   * Mark multiple blocks as completed
   */
  async markAsCompletedBatch(blocks: UnprocessedBlock[]): Promise<void> {
    if (blocks.length === 0) {
      return;
    }

    const now = new Date();
    blocks.forEach((block) => {
      block.status = BlockProcessingStatus.COMPLETED;
      block.processedAt = now;
    });

    await this.repository.save(blocks);
  }

  /**
   * Mark a block as failed
   */
  async markAsFailed(block: UnprocessedBlock, error: Error): Promise<void> {
    block.status = BlockProcessingStatus.FAILED;
    block.retryCount += 1;
    block.errorMessage = error.message;
    await this.repository.save(block);
  }

  /**
   * Check for reorgs in recent blocks (optimized)
   */
  async checkForReorgs(chainId: number, currentBlock: Block): Promise<void> {
    const recentBlocks = await this.repository.find({
      where: {
        chainId,
        blockNumber: MoreThanOrEqual(currentBlock.number - this.REORG_DEPTH),
        status: BlockProcessingStatus.COMPLETED,
      },
      order: {
        blockNumber: "DESC",
      },
    });

    if (recentBlocks.length === 0) {
      return;
    }

    // Batch fetch blocks from chain
    const blockNumbers = recentBlocks.map((b) => b.blockNumber);
    const chainBlocks = await this.getBlocksFromChainBatch(
      chainId,
      blockNumbers
    );

    const blocksToReorg: UnprocessedBlock[] = [];
    const newBlocksToCreate: Block[] = [];

    for (const storedBlock of recentBlocks) {
      const chainBlock = chainBlocks.get(storedBlock.blockNumber);

      if (!chainBlock || chainBlock.hash !== storedBlock.blockHash) {
        logger.warn("Reorg detected", {
          chainId,
          blockNumber: storedBlock.blockNumber,
          storedHash: storedBlock.blockHash,
          chainHash: chainBlock?.hash,
        });

        storedBlock.status = BlockProcessingStatus.REORGED;
        storedBlock.errorMessage = "Block hash mismatch - reorg detected";
        blocksToReorg.push(storedBlock);

        if (chainBlock) {
          newBlocksToCreate.push(chainBlock);
        }
      }
    }

    // Batch update reorged blocks
    if (blocksToReorg.length > 0) {
      await this.repository.save(blocksToReorg);
    }

    // Batch create new blocks for reorged ones
    if (newBlocksToCreate.length > 0) {
      await this.addBlocks(chainId, newBlocksToCreate);
    }
  }

  /**
   * Get blocks that need to be reprocessed due to reorgs
   */
  async getReorgedBlocks(chainId: number): Promise<UnprocessedBlock[]> {
    return this.repository.find({
      where: {
        chainId,
        status: BlockProcessingStatus.REORGED,
      },
      order: {
        blockNumber: "ASC",
      },
    });
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats(chainId: number): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    reorged: number;
  }> {
    const [pending, processing, completed, failed, reorged] = await Promise.all(
      [
        this.repository.count({
          where: { chainId, status: BlockProcessingStatus.PENDING },
        }),
        this.repository.count({
          where: { chainId, status: BlockProcessingStatus.PROCESSING },
        }),
        this.repository.count({
          where: { chainId, status: BlockProcessingStatus.COMPLETED },
        }),
        this.repository.count({
          where: { chainId, status: BlockProcessingStatus.FAILED },
        }),
        this.repository.count({
          where: { chainId, status: BlockProcessingStatus.REORGED },
        }),
      ]
    );

    return { pending, processing, completed, failed, reorged };
  }

  /**
   * Clean up old completed blocks
   */
  async cleanupCompletedBlocks(
    chainId: number,
    olderThanDays: number = 7
  ): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.repository.delete({
      chainId,
      status: BlockProcessingStatus.COMPLETED,
      processedAt: LessThan(cutoffDate),
    });

    const deletedCount = result.affected || 0;

    logger.info("Cleaned up old completed unprocessed blocks", {
      chainId,
      cutoffDate,
      deletedCount,
    });

    return deletedCount;
  }

  private async createNewBlockEntry(
    chainId: number,
    block: Block
  ): Promise<UnprocessedBlock> {
    const newBlock = new UnprocessedBlock();
    newBlock.chainId = chainId;
    newBlock.blockNumber = block.number;
    newBlock.blockHash = block.hash ?? "";
    newBlock.parentHash = block.parentHash;
    newBlock.status = BlockProcessingStatus.PENDING;
    newBlock.retryCount = 0;
    newBlock.blockData = block;

    return this.repository.save(newBlock);
  }

  private async getBlockFromChain(
    chainId: number,
    blockNumber: number
  ): Promise<Block | null> {
    try {
      const block = await this.provider.getBlock(blockNumber);
      if (!block) {
        logger.warn("Block not found on chain", {
          chainId,
          blockNumber,
        });
        return null;
      }
      return block;
    } catch (error) {
      logger.error("Error fetching block from chain", {
        chainId,
        blockNumber,
        error,
      });
      return null;
    }
  }

  /**
   * Batch fetch blocks from chain
   */
  private async getBlocksFromChainBatch(
    chainId: number,
    blockNumbers: number[]
  ): Promise<Map<number, Block | null>> {
    const result = new Map<number, Block | null>();

    // Process in smaller batches to avoid overwhelming the RPC
    const batchSize = 10;
    for (let i = 0; i < blockNumbers.length; i += batchSize) {
      const batch = blockNumbers.slice(i, i + batchSize);

      const batchPromises = batch.map(async (blockNumber) => {
        try {
          const block = await this.provider.getBlock(blockNumber);
          return { blockNumber, block };
        } catch (error) {
          logger.error("Error fetching block from chain in batch", {
            chainId,
            blockNumber,
            error,
          });
          return { blockNumber, block: null };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const { blockNumber, block } of batchResults) {
        result.set(blockNumber, block);
      }
    }

    return result;
  }
}
