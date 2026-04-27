/* eslint-disable no-console */
// Single entrypoint for the Fly.io container.
// Run with `bun server.ts` (bun resolves TS natively in dev and prod).
// Hosts: Next.js (pages + API), WebSocket /api/ws/match/:id,
//        in-process matchmaking scheduler + match runner pump.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { handleMatchWs } from "./src/server/ws-handler.ts";
import { startScheduler } from "./src/server/scheduler.ts";
import { pickPendingMatches, runOneMatch } from "./src/server/run-match.ts";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const parsed = parse(req.url ?? "", true);
  void handle(req, res, parsed).catch((err: unknown) => {
    console.error("request error:", err);
    res.statusCode = 500;
    res.end("internal error");
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const m = url.pathname.match(/^\/api\/ws\/match\/([^/]+)$/);
    if (!m) {
      socket.destroy();
      return;
    }
    const matchId = m[1]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleMatchWs(ws, req, matchId);
    });
  } catch (err) {
    console.error("upgrade error:", err);
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`> ready on http://0.0.0.0:${port}`);
});

if (process.env.DISABLE_BACKGROUND !== "1") {
  startScheduler();
  setInterval(() => {
    void (async () => {
      try {
        const pending = await pickPendingMatches(1);
        for (const id of pending) await runOneMatch(id);
      } catch (err) {
        console.error("[runner pump]", err);
      }
    })();
  }, 2000);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    server.close();
    wss.close();
    process.exit(0);
  });
}
