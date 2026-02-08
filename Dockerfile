# Multi-stage build for optimized and secure Node.js backend

# ============================================
# Stage 1: Dependencies (Build environment)
# ============================================
FROM node:22-alpine AS dependencies

# Install security updates
RUN apk upgrade --no-cache

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci --include=dev

# ============================================
# Stage 2: Build
# ============================================
FROM node:22-alpine AS build

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build application (if TypeScript or any build step exists)
RUN npm run build 2>/dev/null || echo "No build step configured"

# Remove development dependencies
RUN npm prune --production

# ============================================
# Stage 3: Production (Final image)
# ============================================
FROM node:22-alpine AS production

# Install security updates and dumb-init
RUN apk upgrade --no-cache && \
    apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy only production dependencies
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=build --chown=nodejs:nodejs /app ./

# Create writable logs directory for the application
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Remove unnecessary files for security
RUN rm -rf \
    .git \
    .github \
    .vscode \
    .env.example \
    .env.development \
    .env.production \
    tests \
    test \
    __tests__ \
    *.test.js \
    *.spec.js \
    *.md \
    Dockerfile* \
    docker-compose*.yml

# Set environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_LOGLEVEL=warn

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Expose port
EXPOSE 8080

# Switch to non-root user
USER nodejs

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "server.js"]

# ============================================
# Metadata (OCI labels)
# ============================================
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.title="CareNest Backend API" \
      org.opencontainers.image.description="Multi-tenant invoice management backend" \
      org.opencontainers.image.url="https://github.com/your-org/carenest" \
      org.opencontainers.image.source="https://github.com/your-org/carenest" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.vendor="CareNest" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="CareNest Team"
