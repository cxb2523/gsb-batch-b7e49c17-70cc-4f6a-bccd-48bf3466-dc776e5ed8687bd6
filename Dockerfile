# ==========================================
# CanvHQ Unified Production Container
# Architecture: Single-container SPA + API (Directus Pattern)
# Base: Node 24 Alpine
# ==========================================

# STAGE 1: Build Frontend Assets
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN corepack enable && corepack install

COPY frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm run build

# STAGE 2: Build Backend Application
FROM node:24-alpine AS backend-builder
WORKDIR /app/backend

COPY backend/package.json ./
RUN corepack enable && corepack install

COPY backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY backend/prisma ./prisma
COPY backend/prisma7.config.ts ./
RUN pnpm exec prisma generate

COPY backend/ ./
RUN pnpm run build

# STAGE 3: Production Runner
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV SCARF_ANALYTICS=false
ENV COREPACK_HOME=/usr/local/share/corepack

# Install runtime utilities for healthcheck, backup and package management
RUN apk add --no-cache curl postgresql16-client && \
    corepack enable

# Prepare corepack for pnpm from package.json without hard-coding the version
COPY backend/package.json ./
RUN corepack install && \
    pnpm --version && \
    chmod -R 755 /usr/local/share/corepack

# The base image ships npm with its own copies of packages, which the vulnerability scan reports
# and the image never uses: it installs and runs through pnpm. Dropping npm removes them.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Setup directories with non-root ownership before copying project files
RUN mkdir -p /app/backups && chown -R node:node /app

COPY --chown=node:node backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./

USER node

# Install production dependencies only as node user
RUN pnpm install --frozen-lockfile --prod

# Copy Prisma schema, migrations, and config
COPY --chown=node:node backend/prisma ./prisma
COPY --chown=node:node backend/prisma7.config.ts ./

# Generate Prisma client in the runtime stage
RUN pnpm exec prisma generate

# Copy compiled backend application
COPY --chown=node:node --from=backend-builder /app/backend/dist ./dist

# Copy compiled frontend SPA into public static directory
COPY --chown=node:node --from=frontend-builder /app/frontend/dist ./public

# Copy entrypoint script and maintenance scripts
COPY --chown=node:node docker-entrypoint.sh ./
COPY --chown=node:node scripts/demo-wipe.mjs ./scripts/demo-wipe.mjs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
