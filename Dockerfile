# syntax=docker/dockerfile:1.7
# Code Arena — single-image deploy: Next.js + WebSocket + scheduler +
# match runner + bot trainer (in-process).
#
# Bot sandboxing: SubprocessSandbox only. nsjail is no longer built — its
# 30-line C++ compile dominated free-tier build time/RAM, and the existing
# subprocess fallback (per-tick wall timeout + AcornValidator static
# blocklist) is good enough for a trust-once / semi-trusted deploy.
# If you need hard memory caps later, see the Dockerfile in git history at
# tag pre-nsjail-removal.
FROM oven/bun:1.3-debian AS builder
WORKDIR /app

COPY package.json bun.lockb* ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/adapters/package.json packages/adapters/
COPY packages/db/package.json packages/db/
COPY tsconfig.json eslint.config.js ./

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps
COPY bots ./bots

# Cap V8 heap so Next.js build worker doesn't get OOM-killed on small hosts.
# next.config.mjs also forces single-threaded build (cpus: 1, no workers).
WORKDIR /app/apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=350"
RUN bun run build

# --- Runtime stage ---
FROM oven/bun:1.3-debian AS runtime
WORKDIR /app

# Need `node` so subprocess sandbox can run the bot harness, plus tini to
# reap zombie bot subprocesses cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Run from the Next app dir so `next()` finds the `.next` build directory
# (default `dir` is process.cwd(), and our build output is here).
WORKDIR /app/apps/web
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "server.ts"]
