import { describe, expect, test } from "bun:test";

import { validateStatic, smokeRun } from "../src/index.ts";

const GOOD = `
export default function decide() {
  return { type: "WAIT" };
}
`;

describe("validateStatic", () => {
  test("accepts a clean single-file bot", () => {
    const r = validateStatic(GOOD);
    expect(r.ok).toBe(true);
  });

  test("rejects any import (single-file rule)", () => {
    const r = validateStatic(`import fs from "node:fs"; export default () => ({type:"WAIT"});`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "no-imports")).toBe(true);
  });

  test("rejects relative imports too", () => {
    const r = validateStatic(`import x from "./other.js"; export default () => ({type:"WAIT"});`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "no-imports")).toBe(true);
  });

  test("rejects bare third-party import", () => {
    const r = validateStatic(`import _ from "lodash"; export default () => ({type:"WAIT"});`);
    expect(r.ok).toBe(false);
  });

  test("rejects eval()", () => {
    const r = validateStatic(`export default () => { eval("1+1"); return {type:"WAIT"}; };`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "forbidden-call")).toBe(true);
  });

  test("rejects new Function", () => {
    const r = validateStatic(`export default () => { new Function("return 1"); return {type:"WAIT"}; };`);
    expect(r.ok).toBe(false);
  });

  test("rejects dynamic import()", () => {
    const r = validateStatic(`export default async () => { await import("fs"); return {type:"WAIT"}; };`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "dynamic-import")).toBe(true);
  });

  test("rejects parse errors", () => {
    const r = validateStatic(`function (`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "parse")).toBe(true);
  });

  test("rejects oversized code", () => {
    const huge = "a".repeat(300_000);
    const r = validateStatic(huge);
    expect(r.ok).toBe(false);
  });

  test("warns on referencing forbidden globals", () => {
    const r = validateStatic(`export default () => { fetch("http://evil"); return {type:"WAIT"}; };`);
    expect(r.issues.some((i) => i.code === "global-ref")).toBe(true);
  });
});

describe("smokeRun", () => {
  test("good bot passes smoke", async () => {
    const r = await smokeRun(GOOD, { timeoutMs: 2000 });
    expect(r.ok).toBe(true);
    expect(r.responded).toBe(true);
  });

  test("bot using globals (helpers) passes smoke", async () => {
    const r = await smokeRun(
      `export default function decide(obs) {
        if (here(obs)?.kind === "item") return { type: "PICKUP" };
        return { type: "MOVE", dir: pickRandom(DIRS) };
      }`,
      { timeoutMs: 2000 },
    );
    expect(r.ok).toBe(true);
    expect(r.responded).toBe(true);
  });

  test("bot whose decide throws still produces WAIT (harness catches)", async () => {
    const r = await smokeRun(
      `export default function decide() { throw new Error("nope"); }`,
      { timeoutMs: 2000 },
    );
    expect(r.responded).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("infinite-loop bot times out", async () => {
    const r = await smokeRun(
      `export default function decide() { while(true){} }`,
      { timeoutMs: 500 },
    );
    expect(r.ok).toBe(false);
    expect(r.responded).toBe(false);
  });
});
