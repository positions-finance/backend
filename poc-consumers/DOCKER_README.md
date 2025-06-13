# Docker Setup for POC Consumers

This project includes Docker configuration for easy deployment and development.

## Files Created

- `Dockerfile` - Multi-stage Docker build for production and development
- `docker-compose.yml` - Complete stack with PostgreSQL and Redis
- `.dockerignore` - Optimizes Docker build context

## Quick Start

### Using Docker Compose (Recommended)

1. **Production deployment:**

   ```bash
   # Set required environment variables
   export PRIVATE_KEY="your_private_key_here"

   # Start the complete stack
   docker-compose up -d
   ```

2. **Development mode:**
   ```bash
   # Start with development profile
   docker-compose --profile dev up -d
   ```

### Using Docker Only

1. **Build the image:**

   ```bash
   # Production build
   docker build -t poc-consumers:latest .

   # Development build
   docker build --target development -t poc-consumers:dev .
   ```

2. **Run the container:**
   ```bash
   docker run -p 3001:3001 \
     -e DB_HOST=your_db_host \
     -e REDIS_HOST=your_redis_host \
     -e PRIVATE_KEY=your_private_key \
     poc-consumers:latest
   ```

## Environment Variables

### Required Variables

- `PRIVATE_KEY` - Your blockchain private key

### Database Configuration

- `DB_HOST` - PostgreSQL host (default: localhost)
- `DB_PORT` - PostgreSQL port (default: 5432)
- `DB_USERNAME` - Database username (default: postgres)
- `DB_PASSWORD` - Database password (default: postgres)
- `DB_NAME` - Database name (default: blockchain_consumer)

### Redis Configuration

- `REDIS_HOST` - Redis host (default: localhost)
- `REDIS_PORT` - Redis port (default: 6379)
- `REDIS_CHANNEL` - Redis channel (default: blockchain-events)

### Application Configuration

- `API_PORT` - Application port (default: 3001)
- `API_HOST` - Application host (default: 0.0.0.0)
- `NODE_ENV` - Environment (development/production)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)

## Docker Compose Services

### Production Stack

- **app** - Main application (port 3001)
- **postgres** - PostgreSQL database (port 5432)
- **redis** - Redis cache (port 6379)

### Development Stack

- **app-dev** - Development application with hot reload (port 3002)
- **postgres** - PostgreSQL database (port 5432)
- **redis** - Redis cache (port 6379)

## Useful Commands

```bash
# View logs
docker-compose logs -f app

# Access application shell
docker-compose exec app sh

# Run database migrations
docker-compose exec app yarn migration:run

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Rebuild and restart
docker-compose up --build -d
```

## Health Checks

The application includes health checks:

- **Docker**: Built-in health check on port 3001/health
- **Compose**: Service dependencies with health checks

## Security Features

- Non-root user execution
- Minimal Alpine Linux base image
- Production dependencies only in final image
- Proper file permissions

## Troubleshooting

1. **Database connection issues:**

   - Ensure PostgreSQL is running and accessible
   - Check database credentials and host configuration

2. **Redis connection issues:**

   - Verify Redis is running and accessible
   - Check Redis host and port configuration

3. **Build failures:**

   - Clear Docker cache: `docker system prune -a`
   - Check for missing dependencies in package.json

4. **Permission issues:**
   - Ensure proper file ownership in mounted volumes
   - Check that the nodejs user has required permissions
