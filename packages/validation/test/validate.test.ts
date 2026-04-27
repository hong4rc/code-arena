import { describe, expect, test } from "bun:test";
import { validateStatic, smokeRun } from "../src/index.ts";

const GOOD = `
import { runBot } from "./_sdk.js";
runBot(() => ({ type: "WAIT" }));
`;

describe("validateStatic", () => {
  test("accepts a clean bot", () => {
    const r = validateStatic(GOOD);
    expect(r.ok).toBe(true);
  });

  test("rejects fs import", () => {
    const r = validateStatic(`import fs from "node:fs"; export const x = 1;`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "forbidden-import")).toBe(true);
  });

  test("rejects child_process import", () => {
    const r = validateStatic(`import cp from "child_process";`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "forbidden-import")).toBe(true);
  });

  test("rejects bare third-party import", () => {
    const r = validateStatic(`import _ from "lodash";`);
    expect(r.ok).toBe(false);
  });

  test("rejects eval()", () => {
    const r = validateStatic(`eval("1+1");`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "forbidden-call")).toBe(true);
  });

  test("rejects new Function", () => {
    const r = validateStatic(`const f = new Function("return 1");`);
    expect(r.ok).toBe(false);
  });

  test("rejects dynamic import()", () => {
    const r = validateStatic(`async function f() { await import("fs"); }`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "dynamic-import")).toBe(true);
  });

  test("rejects bad relative import", () => {
    const r = validateStatic(`import x from "./other.js";`);
    expect(r.ok).toBe(false);
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
});

describe("smokeRun", () => {
  test("good bot passes smoke", async () => {
    const r = await smokeRun(GOOD, { timeoutMs: 2000 });
    expect(r.ok).toBe(true);
    expect(r.responded).toBe(true);
  });

  test("bot whose decide throws still produces WAIT (SDK catches)", async () => {
    const r = await smokeRun(
      `import { runBot } from "./_sdk.js"; runBot(() => { throw new Error("nope"); });`,
      { timeoutMs: 2000 },
    );
    // SDK's try/catch around decide returns { type: "WAIT" } — that's a valid action.
    expect(r.responded).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("infinite-loop bot times out", async () => {
    const r = await smokeRun(
      `import { runBot } from "./_sdk.js"; runBot(() => { while(true){} });`,
      { timeoutMs: 500 },
    );
    expect(r.ok).toBe(false);
    expect(r.responded).toBe(false);
  });
});
