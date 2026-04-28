/* eslint-disable no-console */
// Periodic self-ping to the PUBLIC URL so Render's free tier doesn't spin
// down after 15 min idle. The request goes out → public DNS → back into the
// service, which counts as external traffic (a loopback to localhost would
// not).
//
// Env:
//   KEEPALIVE_URL          override target (default: NEXT_PUBLIC_APP_URL or AUTH_URL + /api/health)
//   KEEPALIVE_INTERVAL_MS  ping interval (default 10 minutes)
//   DISABLE_KEEPALIVE=1    skip entirely
import { setTimeout as setT } from "node:timers";

// Default to 30 s — aggressive but cheap, and guarantees the service never
// idles. Render doesn't rate-limit your own service; only bandwidth counts,
// and a 200-byte healthcheck doesn't dent that.
const DEFAULT_INTERVAL_MS = 30 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startKeepAliveDriver(): void {
  if (timer) return;
  if (process.env.DISABLE_KEEPALIVE === "1") {
    console.log("[keepalive] disabled (DISABLE_KEEPALIVE=1)");
    return;
  }
  // Only useful on a deployed service. In dev there's nothing to keep alive.
  if (process.env.NODE_ENV !== "production") {
    console.log("[keepalive] skipped (not production)");
    return;
  }

  const baseUrl = process.env.KEEPALIVE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.AUTH_URL;
  if (!baseUrl) {
    console.log("[keepalive] no public URL configured (set NEXT_PUBLIC_APP_URL or KEEPALIVE_URL) — skipping");
    return;
  }
  const target = process.env.KEEPALIVE_URL ?? `${baseUrl.replace(/\/$/, "")}/api/health`;
  const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);

  console.log(`[keepalive] starting — pinging ${target} every ${intervalMs / 1000}s`);
  // First ping after a short delay so it doesn't race the server's own boot.
  setT(() => void ping(target), 5000);
  timer = setInterval(() => void ping(target), intervalMs);
}

export function stopKeepAliveDriver(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function ping(url: string): Promise<void> {
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const ms = Date.now() - start;
    if (res.ok) {
      console.log(`[keepalive] ${url} → ${res.status} in ${ms}ms`);
    } else {
      console.warn(`[keepalive] ${url} → ${res.status} in ${ms}ms`);
    }
  } catch (error) {
    console.warn(`[keepalive] ${url} failed:`, error instanceof Error ? error.message : error);
  }
}
