import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "acorn";
import { simple as walkSimple } from "acorn-walk";

import type { ValidationIssue, ValidationResult, Validator } from "@arena/application";
import { mergeConfig, type Observation } from "@arena/domain";

import { findHarness } from "../sandbox/harness-path.ts";
import { ask, kill, spawn } from "../sandbox/spawn.ts";

const MAX_BYTES = 256 * 1024;

const FORBIDDEN_GLOBALS = new Set([
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "Bun", "process", "require",
]);

export function validateStatic(code: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (Buffer.byteLength(code, "utf8") > MAX_BYTES) {
    issues.push({ level: "error", code: "size", message: `Bot code exceeds ${MAX_BYTES} bytes` });
    return { ok: false, issues };
  }

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 2022, sourceType: "module", locations: true });
  } catch (error) {
    issues.push({
      level: "error",
      code: "parse",
      message: `Parse error: ${(error as Error).message}`,
    });
    return { ok: false, issues };
  }

  walkSimple(ast, {
    ImportDeclaration(node) {
      const src = (node as unknown as { source: { value: string } }).source.value;
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      issues.push({
        level: "error",
        code: "no-imports",
        message: `Bots are single-file with no imports. Found: '${src}'. Helpers like adjacent, nearestBot, dirTo are available as globals.`,
        ...(line === undefined ? {} : { line }),
      });
    },
    CallExpression(node) {
      const callee = (node as unknown as { callee: { type: string; name?: string } }).callee;
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      if (callee.type === "Identifier" && (callee.name === "eval" || callee.name === "Function")) {
        issues.push({ level: "error", code: "forbidden-call", message: `'${callee.name}' is not allowed`, ...(line === undefined ? {} : { line }) });
      }
    },
    ImportExpression(node) {
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      issues.push({ level: "error", code: "dynamic-import", message: `Dynamic import() is not allowed`, ...(line === undefined ? {} : { line }) });
    },
    NewExpression(node) {
      const callee = (node as unknown as { callee: { type: string; name?: string } }).callee;
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      if (callee.type === "Identifier" && callee.name === "Function") {
        issues.push({ level: "error", code: "forbidden-new", message: `'new Function' is not allowed`, ...(line === undefined ? {} : { line }) });
      }
    },
    Identifier(node) {
      const n = (node as unknown as { name: string }).name;
      if (FORBIDDEN_GLOBALS.has(n)) {
        issues.push({ level: "warning", code: "global-ref", message: `Reference to global '${n}' (will fail at runtime in sandbox)` });
      }
    },
  });

  return { ok: !issues.some((i) => i.level === "error"), issues };
}

export interface SmokeRunOptions {
  timeoutMs?: number;
  harnessPath?: string;
}

/** Boot the bot, hand it one canned observation, expect a valid action within timeoutMs. */
export async function smokeRun(code: string, opts: SmokeRunOptions = {}): Promise<ValidationResult & { responded: boolean }> {
  const issues: ValidationIssue[] = [];
  const dir = mkdtempSync(join(tmpdir(), "arena-smoke-"));
  try {
    const harnessPath = opts.harnessPath ?? findHarness();
    const localHarness = join(dir, "harness.js");
    if (!existsSync(harnessPath)) {
      issues.push({ level: "error", code: "harness-missing", message: "Runtime harness not found" });
      return { ok: false, issues, responded: false };
    }
    copyFileSync(harnessPath, localHarness);
    const botPath = join(dir, "bot.js");
    writeFileSync(botPath, code, "utf8");

    const sp = spawn({ cmd: ["bun", localHarness, botPath] });
    const config = mergeConfig({ width: 5, height: 5 });
    const obs: Observation = {
      tick: 0,
      self: { x: 2, y: 2, hp: 100, attack: 10, speed: 1, inventory: [] },
      view: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ kind: "empty" as const }))),
      tickTimeMs: config.tickTimeMs,
    };
    const result = await ask(sp, obs, opts.timeoutMs ?? 1000);
    kill(sp);

    if (result.protocolError === "timeout") {
      issues.push({ level: "error", code: "smoke-timeout", message: "Bot did not produce an action within 1s" });
      return { ok: false, issues, responded: false, stderr: sp.stderr };
    }
    if (result.protocolError === "crash") {
      issues.push({ level: "error", code: "smoke-crash", message: "Bot process crashed during smoke run" });
      return { ok: false, issues, responded: false, stderr: sp.stderr };
    }
    if (result.protocolError === "malformed") {
      issues.push({ level: "error", code: "smoke-malformed", message: "Bot wrote malformed JSON to stdout" });
      return { ok: false, issues, responded: true, stderr: sp.stderr };
    }
    return { ok: true, issues, responded: true, stderr: sp.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Validator implementation: static AST checks + smoke run. */
export class AcornValidator implements Validator {
  async validate(code: string): Promise<ValidationResult> {
    const stat = validateStatic(code);
    if (!stat.ok) return stat;
    const smoke = await smokeRun(code);
    return {
      ok: stat.ok && smoke.ok,
      issues: [...stat.issues, ...smoke.issues],
      ...(smoke.stderr ? { stderr: smoke.stderr } : {}),
    };
  }
}
