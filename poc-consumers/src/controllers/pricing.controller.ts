import { Request, Response } from "express";
import { PricingService } from "@/services/PricingService";
import logger from "@/utils/logger";

export class PricingController {
  private pricingService: PricingService;

  constructor() {
    this.pricingService = new PricingService();
  }

  /**
   * Get USD price for a single token
   * @route POST /api/pricing/token
   */
  public getTokenPrice = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tokenAddress, amount, chainId } = req.body;

      if (!tokenAddress || !amount || !chainId) {
        res.status(400).json({
          error: "Missing required fields: tokenAddress, amount, chainId",
        });
        return;
      }

      const usdPrice = await this.pricingService.getUsdPrice(
        tokenAddress,
        amount,
        chainId
      );

      res.json({
        success: true,
        data: {
          tokenAddress,
          amount,
          chainId,
          usdValue: usdPrice,
        },
      });
    } catch (error) {
      logger.error(`Error getting token price: ${error}`);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  /**
   * Get market price for a single token
   * @route GET /api/pricing/market/:chainId/:tokenAddress
   */
  public getMarketPrice = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { chainId, tokenAddress } = req.params;

      if (!chainId || !tokenAddress) {
        res.status(400).json({
          error: "Missing required parameters: chainId, tokenAddress",
        });
        return;
      }

      const marketPrice = await this.pricingService.fetchMarketPrice(
        tokenAddress,
        parseInt(chainId)
      );

      if (!marketPrice) {
        res.status(404).json({
          error: "Price not found for the specified token",
        });
        return;
      }

      res.json({
        success: true,
        data: {
          tokenAddress,
          chainId: parseInt(chainId),
          price: marketPrice.price,
          decimals: marketPrice.decimals,
        },
      });
    } catch (error) {
      logger.error(`Error getting market price: ${error}`);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  /**
   * Get multiple token prices
   * @route POST /api/pricing/multiple
   */
  public getMultiplePrices = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { tokens } = req.body;

      if (!tokens || !Array.isArray(tokens)) {
        res.status(400).json({
          error: "Missing or invalid tokens array",
        });
        return;
      }

      if (tokens.length > 25) {
        res.status(400).json({
          error: "Maximum 25 tokens allowed per request",
        });
        return;
      }

      const prices = await this.pricingService.fetchMultiplePrices(tokens);

      res.json({
        success: true,
        data: prices,
      });
    } catch (error) {
      logger.error(`Error getting multiple prices: ${error}`);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  /**
   * Get supported networks
   * @route GET /api/pricing/networks
   */
  public getSupportedNetworks = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const networks = this.pricingService.getSupportedNetworks();

      res.json({
        success: true,
        data: networks,
      });
    } catch (error) {
      logger.error(`Error getting supported networks: ${error}`);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  /**
   * Clear price cache
   * @route POST /api/pricing/cache/clear
   */
  public clearCache = async (req: Request, res: Response): Promise<void> => {
    try {
      this.pricingService.clearCache();

      res.json({
        success: true,
        message: "Price cache cleared successfully",
      });
    } catch (error) {
      logger.error(`Error clearing cache: ${error}`);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}
