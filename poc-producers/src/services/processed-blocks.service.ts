import { Repository, Between } from "typeorm";
import { ProcessedBlock } from "../entities/processed-blocks.entity";
import { Block } from "ethers";
import logger from "../utils/logger";

export class ProcessedBlocksService {
  constructor(private repository: Repository<ProcessedBlock>) {}

  /**
   * Add a processed block
   */
  async addBlock(chainId: number, block: Block): Promise<ProcessedBlock> {
    const processedBlock = this.repository.create({
      chainId,
      blockNumber: block.number,
      blockHash: block.hash || "",
      parentHash: block.parentHash || "",
      blockData: block,
      isReorged: false,
    });

    await this.repository.save(processedBlock);

    logger.debug("Added processed block", {
      chainId,
      blockNumber: block.number,
      blockHash: block.hash,
    });

    return processedBlock;
  }

  /**
   * Add multiple processed blocks in batch
   */
  async addBlocks(chainId: number, blocks: Block[]): Promise<ProcessedBlock[]> {
    if (blocks.length === 0) {
      return [];
    }

    const processedBlocks = blocks.map((block) =>
      this.repository.create({
        chainId,
        blockNumber: block.number,
        blockHash: block.hash || "",
        parentHash: block.parentHash || "",
        blockData: block,
        isReorged: false,
      })
    );

    const savedBlocks = await this.repository.save(processedBlocks);

    logger.debug("Added processed blocks in batch", {
      chainId,
      count: blocks.length,
      blockNumbers: blocks.map((b) => b.number),
    });

    return savedBlocks;
  }

  /**
   * Get the latest processed block for a chain
   */
  async getLatestProcessedBlock(
    chainId: number
  ): Promise<ProcessedBlock | null> {
    return this.repository.findOne({
      where: { chainId, isReorged: false },
      order: { blockNumber: "DESC" },
    });
  }

  /**
   * Check if a block has been processed
   */
  async isBlockProcessed(
    chainId: number,
    blockNumber: number
  ): Promise<boolean> {
    const count = await this.repository.count({
      where: { chainId, blockNumber, isReorged: false },
    });
    return count > 0;
  }

  /**
   * Check if multiple blocks have been processed (batch operation)
   */
  async areBlocksProcessed(
    chainId: number,
    blockNumbers: number[]
  ): Promise<Map<number, boolean>> {
    if (blockNumbers.length === 0) {
      return new Map();
    }

    const processedBlocks = await this.repository.find({
      where: {
        chainId,
        blockNumber: Between(
          Math.min(...blockNumbers),
          Math.max(...blockNumbers)
        ),
        isReorged: false,
      },
      select: ["blockNumber"],
    });

    const processedSet = new Set(processedBlocks.map((b) => b.blockNumber));
    const result = new Map<number, boolean>();

    for (const blockNumber of blockNumbers) {
      result.set(blockNumber, processedSet.has(blockNumber));
    }

    return result;
  }

  /**
   * Get all processed blocks in a range
   */
  async getProcessedBlocksInRange(
    chainId: number,
    startBlock: number,
    endBlock: number
  ): Promise<ProcessedBlock[]> {
    return this.repository.find({
      where: {
        chainId,
        blockNumber: Between(startBlock, endBlock),
        isReorged: false,
      },
      order: { blockNumber: "ASC" },
    });
  }

  /**
   * Mark blocks as reorged
   */
  async markBlocksAsReorged(
    chainId: number,
    blockNumbers: number[]
  ): Promise<void> {
    if (blockNumbers.length === 0) {
      return;
    }

    await this.repository.update(
      {
        chainId,
        blockNumber: Between(
          Math.min(...blockNumbers),
          Math.max(...blockNumbers)
        ),
      },
      { isReorged: true }
    );

    logger.info("Marked blocks as reorged", {
      chainId,
      blockNumbers,
    });
  }

  /**
   * Get all reorged blocks
   */
  async getReorgedBlocks(chainId: number): Promise<ProcessedBlock[]> {
    return this.repository.find({
      where: { chainId, isReorged: true },
      order: { blockNumber: "ASC" },
    });
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats(chainId: number): Promise<{
    totalProcessed: number;
    latestBlock: number | null;
    reorgedCount: number;
  }> {
    const [totalProcessed, latestBlock, reorgedCount] = await Promise.all([
      this.repository.count({ where: { chainId, isReorged: false } }),
      this.getLatestProcessedBlock(chainId).then(
        (block) => block?.blockNumber || null
      ),
      this.repository.count({ where: { chainId, isReorged: true } }),
    ]);

    return {
      totalProcessed,
      latestBlock,
      reorgedCount,
    };
  }

  /**
   * Clean up old processed blocks (for maintenance)
   */
  async cleanupOldBlocks(
    chainId: number,
    keepBlocksCount: number = 10000
  ): Promise<number> {
    const latestBlock = await this.getLatestProcessedBlock(chainId);

    if (!latestBlock || latestBlock.blockNumber < keepBlocksCount) {
      return 0;
    }

    const cutoffBlock = latestBlock.blockNumber - keepBlocksCount;

    const result = await this.repository.delete({
      chainId,
      blockNumber: Between(0, cutoffBlock),
    });

    const deletedCount = result.affected || 0;

    logger.info("Cleaned up old processed blocks", {
      chainId,
      cutoffBlock,
      deletedCount,
    });

    return deletedCount;
  }
}
