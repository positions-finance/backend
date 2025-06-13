# Optimized single-stage Docker build
FROM node:20-alpine

# Install system dependencies in a single layer
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Create non-root user early
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files for dependency caching
COPY package.json yarn.lock ./

# Install all dependencies first (including devDependencies for build)
RUN yarn install --frozen-lockfile --network-timeout 300000 && \
    yarn cache clean

# Copy source code (excluding files in .dockerignore)
COPY . . 

# Build the application
RUN yarn build

# Clean up dev dependencies and unnecessary files, but keep production dependencies
RUN rm -rf node_modules && \
    yarn install --production --frozen-lockfile --network-timeout 300000 && \
    yarn cache clean && \
    rm -rf src/ scripts/ tsconfig.json .git/ && \
    rm -rf /tmp/* /var/tmp/* && \
    find . -name "*.ts" -type f -delete && \
    find . -name "*.map" -type f -delete

# Change ownership to nodejs user BEFORE installing reflect-metadata
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Forcefully install reflect-metadata as the nodejs user
RUN yarn add reflect-metadata@^0.2.2 --production

# Verify reflect-metadata is installed and accessible
RUN ls -la node_modules/ | grep reflect || echo "reflect-metadata not found in node_modules"
RUN test -d node_modules/reflect-metadata || (echo "reflect-metadata directory missing" && exit 1)
RUN node -e "try { require('reflect-metadata'); console.log('reflect-metadata loaded successfully'); } catch(e) { console.error('Failed to load reflect-metadata:', e.message); process.exit(1); }"

# Expose port
EXPOSE 3000

# Add a simple healthcheck that uses the correct port from environment
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const http = require('http'); const port = process.env.API_PORT || 3001; http.get(\`http://localhost:\${port}/health\`, (res) => { if (res.statusCode === 200) { console.log('Health check passed'); process.exit(0); } else { console.error(\`Health check failed with status: \${res.statusCode}\`); process.exit(1); } }).on('error', (err) => { console.error('Health check error:', err.message); process.exit(1); })"

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]   