/* eslint-disable no-console */
// Single entrypoint for the Fly.io / Render container.
// Run with `bun server.ts` (bun resolves TS natively in dev and prod).
// Hosts: Next.js (pages + API), WebSocket /api/ws/match/:id,
//        in-process matchmaking scheduler + match runner pump.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parse } from "node:url";

import next from "next";
import { WebSocketServer } from "ws";

import { startKeepAliveDriver } from "./src/server/keep-alive-driver.ts";
import { startRunnerDriver } from "./src/server/runner-driver.ts";
import { startSchedulerDriver } from "./src/server/scheduler-driver.ts";
import { startTrainerDriver } from "./src/server/trainer-driver.ts";
import { handleMatchWs } from "./src/server/ws-handler.ts";

import type { Duplex } from "node:stream";

type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

// IMPORTANT: separate "bind interface" from "URL hostname".
//   - bindHost is what we listen on. 0.0.0.0 = all interfaces (needed for
//     containers to be reachable from outside).
//   - urlHostname is what Next bakes into req.url and any URL it constructs.
//     If we set this to 0.0.0.0, NextResponse.redirect(new URL(..., req.url))
//     produces http://0.0.0.0:3000/... — but cookies are scoped to "localhost",
//     so the browser arrives without a session cookie → login loop.
const bindHost = "0.0.0.0";
const urlHostname = dev ? "localhost" : (process.env.AUTH_URL?.replace(/^https?:\/\//, "").split(":")[0] ?? "0.0.0.0");

const app = next({ dev, hostname: urlHostname, port });
await app.prepare();
const handle = app.getRequestHandler();
// Next 15+: dev-mode WebSocket upgrades (HMR, server actions) need to be
// forwarded to Next's own upgrade handler. Must come after prepare().
const upgradeHandler = (app as { getUpgradeHandler?: () => UpgradeHandler }).getUpgradeHandler?.();

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const parsed = parse(req.url ?? "", true);
  void handle(req, res, parsed).catch((error: unknown) => {
    console.error("request error:", error);
    res.statusCode = 500;
    res.end("internal error");
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const m = url.pathname.match(/^\/api\/ws\/match\/([^/]+)$/);
  if (m) {
    const matchId = m[1]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleMatchWs(ws, req, matchId);
    });
    return;
  }
  // Anything else (HMR /_next/webpack-hmr, server actions, …) — let Next handle it.
  if (upgradeHandler) {
    upgradeHandler(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, bindHost, () => {
  console.log(`> ready on http://${urlHostname}:${port}`);
});

if (process.env.DISABLE_BACKGROUND !== "1") {
  startSchedulerDriver();
  startRunnerDriver();
  // Trainer is in-process by default. Set DISABLE_TRAINER=1 to opt out
  // (e.g. when Render free spins down and you don't want the loop running).
  if (process.env.DISABLE_TRAINER !== "1") {
    startTrainerDriver();
  }
}
// Keep Render free tier from spinning down (loops out → public DNS → back in).
// Disabled in dev automatically (NODE_ENV !== production) and via DISABLE_KEEPALIVE=1.
startKeepAliveDriver();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    server.close();
    wss.close();
    process.exit(0);
  });
}
