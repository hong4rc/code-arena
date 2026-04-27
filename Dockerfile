# syntax=docker/dockerfile:1.7
# Code Arena — single-image deploy: Next.js + WebSocket + scheduler + match runner.
# Includes nsjail for sandboxing user bot subprocesses.
FROM oven/bun:1.3-debian AS base

# Build nsjail from source. Match the Bun runtime base (Bun 1.3-debian uses
# Debian 12 Bookworm) so libprotobuf links cleanly across stages.
FROM debian:12-slim AS nsjail-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf bison flex gcc g++ git libprotobuf-dev libnl-route-3-dev \
    libtool make pkg-config protobuf-compiler ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth=1 --branch 3.4 https://github.com/google/nsjail.git /nsjail \
    && cd /nsjail && make
# /nsjail/nsjail is the static-ish binary we'll copy into the runtime image.

# --- Build stage: install deps, build Next.js ---
FROM base AS builder
WORKDIR /app

# Copy workspace manifests first for cache friendliness.
COPY package.json bun.lockb* ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/adapters/package.json packages/adapters/
COPY packages/db/package.json packages/db/
COPY tsconfig.json eslint.config.js ./

RUN bun install --frozen-lockfile

# Copy source.
COPY packages ./packages
COPY apps ./apps
COPY bots ./bots

# Build Next.js (standalone output). Cap the V8 heap so Next's build worker
# doesn't get OOM-killed on small build hosts (Render free = 512 MB total).
WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=400"
RUN bun run build

# --- Runtime stage ---
FROM oven/bun:1.3-debian AS runtime
WORKDIR /app

# nsjail runtime deps + a Node binary for bot subprocesses.
# Bookworm package names.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libprotobuf32 libnl-route-3-200 nodejs ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

# Copy nsjail.
COPY --from=nsjail-builder /nsjail/nsjail /usr/local/bin/nsjail

# Copy app artifacts.
COPY --from=builder /app /app

# Non-root user for the bot subprocess workdir; the main Bun process can stay
# as root (nsjail itself drops privileges per-bot).
RUN useradd -u 10001 -m botrunner

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# tini reaps zombie nsjail children cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "/app/apps/web/server.ts"]
