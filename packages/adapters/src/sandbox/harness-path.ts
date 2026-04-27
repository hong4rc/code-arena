import { existsSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = [
  "bots/runtime/harness.js",
  "../bots/runtime/harness.js",
  "../../bots/runtime/harness.js",
  "/app/bots/runtime/harness.js",
];

/** Locate the bot runtime harness (works in dev, monorepo, and Docker container). */
export function findHarness(): string {
  const cwd = process.cwd();
  for (const p of CANDIDATES) {
    const abs = p.startsWith("/") ? p : join(cwd, p);
    if (existsSync(abs)) return abs;
  }
  throw new Error("harness.js not found — looked in: " + CANDIDATES.join(", "));
}
