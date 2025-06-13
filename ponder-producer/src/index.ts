import { ponder } from "ponder:registry";
import {
  RedisService,
  mapEventToBlockchainMessage,
  getRedisConfig,
} from "./lib/redis";

const redisConfig = getRedisConfig();
const redisService = RedisService.getInstance();

(async () => {
  try {
    await redisService.initPublisher(
      redisConfig.host,
      redisConfig.port,
      redisConfig.channel,
      redisConfig.options
    );
    console.log(
      `Redis publisher initialized and connected to ${redisConfig.host}:${redisConfig.port}`
    );
  } catch (error) {
    console.error("Failed to initialize Redis publisher:", error);
  }
})();

async function publishEventToRedis(
  event: any,
  eventName: string,
  contractName: string
) {
  try {
    const publisher = redisService.getPublisher();

    const chainId = 80094;
    const chainName = "berachain";

    const message = mapEventToBlockchainMessage(
      event,
      eventName,
      contractName,
      chainId,
      chainName
    );

    await publisher.publishMessage(message);
    console.log(`Event ${contractName}:${eventName} published to Redis`);
  } catch (error) {
    console.error(
      `Failed to publish event ${contractName}:${eventName} to Redis:`,
      error
    );
  }
}

ponder.on("PocNFT:Transfer", async ({ event, context }) => {
  console.log(event);
  await publishEventToRedis(event, "Transfer", "PocNFT");
});

ponder.on("entrypoint:Deposit", async ({ event, context }) => {
  console.log(event);
  await publishEventToRedis(event, "Deposit", "entrypoint");
});

ponder.on("entrypoint:Withdraw", async ({ event, context }) => {
  console.log(event);
  await publishEventToRedis(event, "Withdraw", "entrypoint");
});

ponder.on("entrypoint:WithdrawRequest", async ({ event, context }) => {
  console.log(event);
  await publishEventToRedis(event, "WithdrawRequest", "entrypoint");
});

ponder.on("relayer:CollateralRequest", async ({ event, context }) => {
  console.log(event);
  await publishEventToRedis(event, "CollateralRequest", "relayer");
});

ponder.on("relayer:CollateralProcess", async ({ event, context }) => {
  console.log(event);
  await publishEventToRedis(event, "CollateralProcess", "relayer");
});

ponder.on("lendingPool:Repay", async ({ event, context }) => {
  console.log(event);
  await publishEventToRedis(event, "Repay", "lendingPool");
});
