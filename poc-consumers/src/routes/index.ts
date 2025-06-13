import { Router } from "express";
import { IConsumerService } from "@/interfaces/consumer.interface";
import { createConsumerRoutes } from "./consumer.routes";
import { createUserRoutes } from "./user.routes";
import { createStatsRoutes } from "./stats.routes";
import { createNftRoutes } from "./nft.routes";
import { createPricingRoutes } from "./pricing.routes";

export const createRoutes = (consumerService: IConsumerService): Router => {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.use("/api/consumers", createConsumerRoutes(consumerService));
  router.use("/api/users", createUserRoutes());
  router.use("/api/stats", createStatsRoutes());
  router.use("/api/pricing", createPricingRoutes());
  router.use("/mint", createNftRoutes());

  return router;
};
