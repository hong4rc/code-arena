import { describe, expect, test } from "bun:test";

import { smokeRun } from "../src/validation/acorn-validator.ts";

/**
 * Smoke-test every advertised helper actually works inside the harness.
 * These confirm the global injection wires up correctly end-to-end.
 */

const helpersBot = `
export default function decide(obs, state) {
  state.calls = (state.calls ?? 0) + 1;

  // Touch every helper at least once — should all be callable.
  log("calls:", state.calls);

  if (DIRS.length !== 4) throw new Error("DIRS broken");
  here(obs);
  adjacent(obs, "UP");
  nearest(obs, () => false);
  nearestBot(obs);
  nearestItem(obs);
  nearestItem(obs, "HEAL");
  visibleBots(obs);
  visibleItems(obs);
  adjacentBots(obs);
  adjacentItems(obs);
  canMove(obs, "UP");
  canAttack(obs, "UP");
  canKill(obs, "UP");
  canPickup(obs);
  attackRange(obs);
  bestAttackDir(obs);
  hasItem(obs, "HEAL");
  hpFraction(obs);
  lowHp(obs);
  dirTo(1, 0);
  fleeFrom(1, 0);
  opposite("UP");
  safestDir(obs);
  smartMove(obs, "UP");
  scanLine(obs, "UP");
  if (turn("UP") !== "RIGHT") throw new Error("turn CW broken");
  if (turn("UP", -1) !== "LEFT") throw new Error("turn CCW broken");
  dist(3, 4);
  dist({ dx: 3, dy: 4 });
  pickRandom(DIRS);

  return { type: "WAIT" };
}
`;

describe("harness helpers", () => {
  test("every helper is callable inside the sandboxed bot", async () => {
    const r = await smokeRun(helpersBot, { timeoutMs: 2000 });
    expect(r.responded).toBe(true);
    expect(r.ok).toBe(true);
    // log() should have written to stderr.
    expect(r.stderr ?? "").toContain("calls:");
  });
});
