# Positions Producer

A Ponder service that listens to blockchain events on Berachain and publishes them to Redis.

## Overview

This service:

- Monitors events from contracts on Berachain (NFT transfers, deposits, withdrawals, etc.)
- Formats and publishes these events to a Redis channel
- Allows for real-time processing of on-chain events

## Prerequisites

- Node.js (v18 or higher)
- pnpm
- Redis instance
- Access to Berachain RPC

## Environment Variables

| Variable                   | Description                        | Default                           |
| -------------------------- | ---------------------------------- | --------------------------------- |
| `REDIS_HOST`               | Redis server host                  | `localhost`                       |
| `REDIS_PORT`               | Redis server port                  | `6379`                            |
| `REDIS_CHANNEL`            | Redis channel to publish events    | `transactions`                    |
| `REDIS_PASSWORD`           | Redis password (optional)          |                                   |
| `REDIS_DB`                 | Redis database number (optional)   |                                   |
| `REDIS_USERNAME`           | Redis username (optional)          |                                   |
| `REDIS_TLS`                | Enable TLS for Redis connection    | `false`                           |
| `REDIS_RETRY_DELAY`        | Retry delay on Redis failover (ms) | `1000`                            |
| `REDIS_ENABLE_READY_CHECK` | Enable Redis ready check           | `true`                            |
| `REDIS_MAX_RETRIES`        | Maximum Redis retries per request  | `3`                               |
| `BERACHAIN_RPC_URL`        | Berachain RPC URL                  | `https://artio.rpc.berachain.com` |

## Setup

### Local Development

1. Install dependencies:

   ```
   pnpm install
   ```

2. Set up your environment variables by creating a `.env` file in the project root:

   ```
   # Redis Configuration
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_CHANNEL=transactions
   # Add any optional Redis configurations as needed

   # Blockchain Configuration
   BERACHAIN_RPC_URL=https://artio.rpc.berachain.com
   # Use your own RPC URL for production
   ```

3. Start the service:
   ```
   pnpm dev
   ```

### Using Docker

1. Build the Docker image:

   ```
   docker build -t positions-producer .
   ```

2. Run the container:
   ```
   docker run -d \
     --name positions-producer \
     -e REDIS_HOST=your-redis-host \
     -e REDIS_PORT=6379 \
     -e BERACHAIN_RPC_URL=your-rpc-url \
     positions-producer
   ```

## Docker Compose

For easy setup with Redis, a `docker-compose.yml` file is included in the project.

1. Start the services:

   ```
   docker-compose up -d
   ```

   This will start both Redis and the positions-producer service.

2. To specify a custom RPC URL, you can set it before running the command:

   ```
   BERACHAIN_RPC_URL=your-custom-rpc-url docker-compose up -d
   ```

3. View logs:

   ```
   docker-compose logs -f
   ```

4. Stop the services:
   ```
   docker-compose down
   ```

## License

[Your license information]
