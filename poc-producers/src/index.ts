import express from "express";
import cors from "cors";
import { json } from "body-parser";
import cron from "node-cron";
import config from "./config/env";
import logger from "./utils/logger";
import BlockchainProviderFactory from "./factories/provider.factory";
import RedisPublisherFactory from "./factories/publisher.factory";
import BlockchainIndexerFactory from "./factories/indexer.factory";
import { BlockchainIndexer } from "./utils/types/indexer.types";
import { TopicFilter } from "./utils/types/blockchain.types";
import { UnprocessedBlocksService } from "./services/unprocessed-blocks.service";
import { AppDataSource, initializeDatabase } from "./config/database";
import { UnprocessedBlock } from "./entities/UnprocessedBlock.entity";

const indexers: Map<string, BlockchainIndexer> = new Map();

/**
 * Configure Berachain indexer with contract addresses and topic filters
 * @param indexer - The blockchain indexer instance for Berachain
 */
async function configureBerachainFilters(
  indexer: BlockchainIndexer
): Promise<void> {
  logger.info("Setting up Berachain contract filters");

  const contractConfigs = [
    {
      // NFT Contract
      contractAddress: "0x11A5398855dDe5e08D87bAcb0d86ef682f7DE118",
      eventTopics: [
        {
          hash: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          description: "NFT Transfer event",
        },
      ],
    },
    {
      // Entrypoint contract
      contractAddress: "0x48bd18FD6c1415DfDCC34abd8CcCB50A6ABca40e",
      eventTopics: [
        {
          hash: "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c",
          description: "Vault Deposit event",
        },
        {
          hash: "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65",
          description: "Vault Withdraw event",
        },
      ],
    },
    {
      // Relayer contract
      contractAddress: "0xBd955F79b14A7A8c20F661F073b7720c5f522254",
      eventTopics: [
        {
          hash: "0xfbcd50bca32be9b5ae9ffde8581848e2d3ef5d3428408cdcc85df48285d33947",
          description: "Borrow Request event",
        },
        {
          hash: "0x91c1d69eb5e88bb79317d4bd6e2e759a394ce9f1735142866a3bda6c5a7d99be",
          description: "Process event",
        },
      ],
    },
    {
      // Lending Pool
      contractAddress: "0x51B2C76d0259078d8D1a4fb7c844D72D30Dd1420",
      eventTopics: [
        {
          hash: "0x6bd5c950a8d8df17f772f5af5fca7f7a6731c9f5ee3218c4fa5ce6a1db031a8f",
          description: "Borrow Repayment event",
        },
      ],
    },
  ];

  const existingFilters = indexer.getTopicFilters();
  for (const filter of existingFilters) {
    indexer.removeTopicFilter(filter.hash);
  }

  let totalFilters = 0;

  for (const config of contractConfigs) {
    for (const eventTopic of config.eventTopics) {
      indexer.addTopicFilter({
        hash: eventTopic.hash,
        description: `${eventTopic.description} (${config.contractAddress})`,
        contractAddress: config.contractAddress,
      });
      totalFilters++;
    }
  }

  // Set concurrent transaction limit for Berachain
  indexer.setConcurrentTransactionLimit?.(20);

  logger.info(
    `Berachain filters setup complete with ${totalFilters} topic filters across ${contractConfigs.length} contracts`
  );
}

/**
 * Initialize an indexer for a specific blockchain
 * @param chainName - Name of the blockchain to index
 * @param topicFilters - Array of topic filters to apply
 */
async function initializeIndexer(
  chainName: string,
  topicFilters: TopicFilter[]
): Promise<void> {
  try {
    logger.info(`Initializing indexer for ${chainName}`);

    const chainConfig = config.chains[chainName];
    if (!chainConfig) {
      logger.error(`No configuration found for chain: ${chainName}`);
      return;
    }

    const provider = BlockchainProviderFactory.createProvider(
      chainName,
      chainConfig.rpcUrl,
      chainConfig.wsUrl
    );

    const publisher = RedisPublisherFactory.createPublisher(
      config.redis.host,
      config.redis.port,
      config.redis.channel,
      {
        password: config.redis.password,
        database: config.redis.database,
        username: config.redis.username,
        tls: config.redis.tls,
      }
    );

    const unprocessedBlocksRepository =
      AppDataSource.getRepository(UnprocessedBlock);

    const unprocessedBlocksService = new UnprocessedBlocksService(
      unprocessedBlocksRepository,
      provider
    );

    const indexer = BlockchainIndexerFactory.createIndexer(
      provider,
      publisher,
      chainName,
      unprocessedBlocksService,
      topicFilters,
      chainConfig.blockConfirmations
    );

    indexers.set(chainName, indexer);

    await indexer.start();

    logger.info(
      `Indexer for ${chainName} initialized and started successfully`
    );
  } catch (error) {
    logger.error(`Failed to initialize indexer for ${chainName}`, { error });
  }
}

/**
 * Stop all indexers
 */
async function stopAllIndexers(): Promise<void> {
  logger.info("Stopping all indexers");

  const stopPromises = Array.from(indexers.entries()).map(
    async ([chainName, indexer]) => {
      try {
        await indexer.stop();
        logger.info(`Indexer for ${chainName} stopped successfully`);
      } catch (error) {
        logger.error(`Error stopping indexer for ${chainName}`, { error });
      }
    }
  );

  await Promise.all(stopPromises);
  indexers.clear();

  logger.info("All indexers stopped");
}

/**
 * Setup API server
 */
function setupApiServer(): express.Application {
  const app = express();

  app.use(cors());
  app.use(json());

  app.get("/health", (req, res) => {
    const health = {
      status: "UP",
      timestamp: new Date().toISOString(),
      indexers: Array.from(indexers.entries()).map(([chainName, indexer]) => ({
        chainName,
        status: indexer.getStatus(),
      })),
    };

    res.json(health);
  });

  app.get("/api/indexers/:chainName/status", (req, res) => {
    const { chainName } = req.params;
    const indexer = indexers.get(chainName);

    if (!indexer) {
      return res.status(404).json({
        error: `Indexer for ${chainName} not found`,
      });
    }

    res.json({
      chainName,
      status: indexer.getStatus(),
    });
  });

  app.get("/api/indexers/:chainName/filters", (req, res) => {
    const { chainName } = req.params;
    const indexer = indexers.get(chainName);

    if (!indexer) {
      return res.status(404).json({
        error: `Indexer for ${chainName} not found`,
      });
    }

    res.json({
      chainName,
      filters: indexer.getTopicFilters(),
    });
  });

  app.post("/api/indexers/:chainName/filters", (req, res) => {
    const { chainName } = req.params;
    const { hash, description } = req.body;

    if (!hash) {
      return res.status(400).json({
        error: "Topic hash is required",
      });
    }

    const indexer = indexers.get(chainName);

    if (!indexer) {
      return res.status(404).json({
        error: `Indexer for ${chainName} not found`,
      });
    }

    indexer.addTopicFilter({ hash, description });

    res.json({
      message: `Filter added to ${chainName}`,
      filter: { hash, description },
    });
  });

  app.delete("/api/indexers/:chainName/filters/:hash", (req, res) => {
    const { chainName, hash } = req.params;

    const indexer = indexers.get(chainName);

    if (!indexer) {
      return res.status(404).json({
        error: `Indexer for ${chainName} not found`,
      });
    }

    indexer.removeTopicFilter(hash);

    res.json({
      message: `Filter removed from ${chainName}`,
      hash,
    });
  });

  app.post("/api/indexers/:chainName/pause", async (req, res) => {
    const { chainName } = req.params;

    const indexer = indexers.get(chainName);

    if (!indexer) {
      return res.status(404).json({
        error: `Indexer for ${chainName} not found`,
      });
    }

    await indexer.pause();

    res.json({
      message: `Indexer for ${chainName} paused`,
    });
  });

  app.post("/api/indexers/:chainName/resume", async (req, res) => {
    const { chainName } = req.params;

    const indexer = indexers.get(chainName);

    if (!indexer) {
      return res.status(404).json({
        error: `Indexer for ${chainName} not found`,
      });
    }

    await indexer.resume();

    res.json({
      message: `Indexer for ${chainName} resumed`,
    });
  });

  return app;
}

/**
 * Setup health check job
 */
function setupHealthCheck(): void {
  cron.schedule("* * * * *", () => {
    logger.debug("Running health check");

    for (const [chainName, indexer] of indexers.entries()) {
      const status = indexer.getStatus();

      logger.debug(`Indexer ${chainName} status`, {
        status,
        healthy: status.isHealthy,
      });

      if (!status.isHealthy && !status.isPaused) {
        logger.warn(
          `Unhealthy indexer detected: ${chainName}, attempting restart`
        );

        indexer
          .stop()
          .then(() => {
            logger.info(`Restarting indexer: ${chainName}`);
            indexer.start().catch((error) => {
              logger.error(`Failed to restart indexer ${chainName}`, { error });
            });
          })
          .catch((error) => {
            logger.error(`Failed to stop unhealthy indexer ${chainName}`, {
              error,
            });
          });
      }
    }
  });

  logger.info("Health check scheduled");
}

/**
 * Main function to start the application
 */
async function main(): Promise<void> {
  try {
    logger.info("Starting blockchain indexer service");

    const app = setupApiServer();

    const server = app.listen(config.api.port, config.api.host, () => {
      logger.info(
        `API server started on ${config.api.host}:${config.api.port}`
      );
    });

    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down");

      await stopAllIndexers();

      server.close(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down");
      await stopAllIndexers();

      server.close(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
    });

    setupHealthCheck();

    const chainNames = Object.keys(config.chains);

    const initialTopicFilters: TopicFilter[] = [
      {
        hash: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        description: "ERC20/NFT Transfer Event",
      },
      {
        hash: "0x76fbc6746f9766ec8a8dc297122a14d120cc5fc43cd3f389031392fd382a236e",
        description: "Vault Deposit Event",
      },
      {
        hash: "0xbbca15b3e869649439bf242f38bb05947443d4653302570cc74a865c747abc91",
        description: "Borrow Request Event",
      },
      {
        hash: "0xe261186bef2cff0598c26dd2131a4306bd852f21dae46c9ca7a96500b4a40972",
        description: "Borrow Processed Event",
      },
      {
        hash: "0x77c6871227e5d2dec8dadd5354f78453203e22e669cd0ec4c19d9a8c5edb31d0",
        description: "Borrow Repaid Event",
      },
      {
        hash: "0x1e8654c3fc91901b235669b278816887272843156bcd33601d80c57cdc8a8c3f",
        description: "Withdraw Request Event",
      },
    ];

    await initializeDatabase();

    for (const chainName of chainNames) {
      await initializeIndexer(chainName, initialTopicFilters);
    }

    const berachainIndexer = indexers.get("berachain");
    if (berachainIndexer) {
      await configureBerachainFilters(berachainIndexer);
      logger.info("Berachain indexer configured with contract filters");
    } else {
      const capitalizedIndexer = indexers.get("Berachain");
      if (capitalizedIndexer) {
        await configureBerachainFilters(capitalizedIndexer);
        logger.info("Berachain indexer configured with contract filters");
      } else {
        logger.warn(
          "Berachain indexer not found, skipping contract filter setup"
        );
      }
    }

    logger.info(
      "All indexers initialized and configured with contract-specific filters"
    );
  } catch (error) {
    logger.error("Failed to start application", { error });
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Unhandled error", { error });
  process.exit(1);
});
