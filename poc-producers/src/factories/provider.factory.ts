import { BlockchainProvider } from "../utils/types/blockchain.types";
import ArbitrumSepoliaProvider from "../providers/arbitrum-sepolia.provider";
import BepoliaProvider from "../providers/bepolia.provider";
import logger from "../utils/logger";
import BerachainProvider from "../providers/berachain.provider";
import ArbitrumMainnetProvider from "../providers/arbitrum-mainnet.provider";

export class BlockchainProviderFactory {
  /**
   * Creates a blockchain provider for the specified chain
   * @param chainName - Name of the blockchain (ethereum, polygon, etc.)
   * @param rpcUrl - RPC URL for the blockchain
   * @param wsUrl - WebSocket URL for the blockchain
   * @returns BlockchainProvider instance
   */
  static createProvider(
    chainName: string,
    rpcUrl: string,
    wsUrl: string
  ): BlockchainProvider {
    logger.info(`Creating blockchain provider for ${chainName}`, {
      rpcUrl,
      wsUrl,
    });

    switch (chainName.toLowerCase()) {
      case "arbitrum-sepolia":
        return new ArbitrumSepoliaProvider(rpcUrl, wsUrl);

      case "bepolia":
        return new BepoliaProvider(rpcUrl, wsUrl);

      case "berachain":
        return new BerachainProvider(rpcUrl, wsUrl);

      case "arbitrum-mainnet":
        return new ArbitrumMainnetProvider(rpcUrl, wsUrl);

      default:
        logger.error(`Unsupported chain: ${chainName}`);
        throw new Error(`Unsupported chain: ${chainName}`);
    }
  }
}

export default BlockchainProviderFactory;
