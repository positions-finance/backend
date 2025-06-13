import { Router } from "express";
import { PricingController } from "@/controllers/pricing.controller";

export const createPricingRoutes = (): Router => {
  const router = Router();
  const pricingController = new PricingController();

  /**
   * @route POST /api/pricing/token
   * @desc Get USD price for a single token
   * @access Public
   */
  router.post("/token", pricingController.getTokenPrice);

  /**
   * @route GET /api/pricing/market/:chainId/:tokenAddress
   * @desc Get market price for a single token
   * @access Public
   */
  router.get(
    "/market/:chainId/:tokenAddress",
    pricingController.getMarketPrice
  );

  /**
   * @route POST /api/pricing/multiple
   * @desc Get multiple token prices
   * @access Public
   */
  router.post("/multiple", pricingController.getMultiplePrices);

  /**
   * @route GET /api/pricing/networks
   * @desc Get supported networks
   * @access Public
   */
  router.get("/networks", pricingController.getSupportedNetworks);

  /**
   * @route POST /api/pricing/cache/clear
   * @desc Clear price cache
   * @access Public
   */
  router.post("/cache/clear", pricingController.clearCache);

  return router;
};
