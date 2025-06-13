import "reflect-metadata";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { initializeDatabase } from "@/database/data-source";
import { RedisConsumerService } from "@/redis/consumer";
import { createRoutes } from "@/routes";
import env from "@/config/env";
import logger from "@/utils/logger";

class Application {
  private app: Express;
  private consumerService: RedisConsumerService;

  constructor() {
    this.app = express();
    this.consumerService = new RedisConsumerService();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(
      cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false,
      })
    );
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    this.app.use("/", createRoutes(this.consumerService));
  }

  public async start(): Promise<void> {
    try {
      logger.info("Initializing database connection...");
      await initializeDatabase();
      logger.info("Database connection initialized successfully");

      logger.info("Starting Redis consumer...");
      await this.consumerService.start();

      const consumerStatus = this.consumerService.getStatus();
      if (consumerStatus.isRunning) {
        logger.info("Redis consumer started successfully");
      } else {
        logger.warn(
          "Redis consumer failed to start, but application will continue"
        );
      }

      const { API_PORT, API_HOST } = env;
      this.app.listen(API_PORT, API_HOST, () => {
        logger.info(`Server is running on http://${API_HOST}:${API_PORT}`);
        logger.info("Health check endpoint available at /health");
      });

      this.setupGracefulShutdown();
    } catch (error) {
      logger.error("Failed to start application:", error);

      // If it's a database error, we should exit
      if (
        error instanceof Error &&
        error.message &&
        error.message.includes("database")
      ) {
        logger.error("Database connection failed, exiting...");
        process.exit(1);
      }

      // For other errors, try to start the HTTP server anyway for health checks
      logger.warn("Starting HTTP server despite startup errors...");
      try {
        const { API_PORT, API_HOST } = env;
        this.app.listen(API_PORT, API_HOST, () => {
          logger.info(
            `Server is running on http://${API_HOST}:${API_PORT} (degraded mode)`
          );
          logger.info("Health check endpoint available at /health");
        });
        this.setupGracefulShutdown();
      } catch (serverError) {
        logger.error("Failed to start HTTP server:", serverError);
        process.exit(1);
      }
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (): Promise<void> => {
      logger.info("Received shutdown signal, gracefully shutting down...");

      try {
        const consumerStatus = this.consumerService.getStatus();
        if (consumerStatus.isRunning) {
          await this.consumerService.stop();
          logger.info("Redis consumer stopped successfully");
        } else {
          logger.info("Redis consumer was not running, skipping stop");
        }

        process.exit(0);
      } catch (error) {
        logger.error("Error during shutdown:", error);
        process.exit(1);
      }
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}

async function bootstrap(): Promise<void> {
  try {
    logger.info("Starting blockchain consumer application...");
    const app = new Application();
    await app.start();
  } catch (error) {
    logger.error("Error starting application:", error);
    process.exit(1);
  }
}

bootstrap();
