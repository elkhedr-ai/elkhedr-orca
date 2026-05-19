# Multi-stage build for Elkhedr Orca
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source
COPY . .

# Production stage
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S orca -u 1001

# Copy dependencies and app from builder
COPY --from=builder --chown=orca:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=orca:nodejs /app/package*.json ./
COPY --chown=orca:nodejs ./src ./src
COPY --chown=orca:nodejs ./data ./data
COPY --chown=orca:nodejs ./sessions ./sessions

USER orca

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
