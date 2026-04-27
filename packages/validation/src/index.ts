import { parse } from "acorn";
import { simple as walkSimple } from "acorn-walk";
import { existsSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawnBot, askBot, killBot } from "@arena/runner";
import { mergeConfig, type Observation } from "@arena/engine";

const MAX_BYTES = 256 * 1024;

const FORBIDDEN_NAMES = new Set([
  "fs", "node:fs", "node:fs/promises",
  "child_process", "node:child_process",
  "net", "node:net",
  "http", "node:http", "https", "node:https",
  "worker_threads", "node:worker_threads",
  "cluster", "node:cluster",
  "dgram", "node:dgram",
  "vm", "node:vm",
  "process", "node:process",
  "os", "node:os",
  "dns", "node:dns",
]);

const FORBIDDEN_GLOBALS = new Set([
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "Bun",
]);

const ALLOWED_RELATIVE = ["./_sdk.js", "../_sdk.js"];

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  line?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateStatic(code: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (Buffer.byteLength(code, "utf8") > MAX_BYTES) {
    issues.push({ level: "error", code: "size", message: `Bot code exceeds ${MAX_BYTES} bytes` });
    return { ok: false, issues };
  }

  let ast;
  try {
    ast = parse(code, { ecmaVersion: 2022, sourceType: "module", locations: true });
  } catch (err) {
    issues.push({
      level: "error",
      code: "parse",
      message: `Parse error: ${(err as Error).message}`,
    });
    return { ok: false, issues };
  }

  walkSimple(ast, {
    ImportDeclaration(node) {
      const src = (node as unknown as { source: { value: string }; loc?: { start: { line: number } } }).source.value;
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      if (FORBIDDEN_NAMES.has(src)) {
        issues.push({ level: "error", code: "forbidden-import", message: `Import of '${src}' is not allowed`, ...(line !== undefined ? { line } : {}) });
      } else if (src.startsWith(".")) {
        if (!ALLOWED_RELATIVE.includes(src)) {
          issues.push({ level: "error", code: "forbidden-relative-import", message: `Relative import '${src}' is not allowed (use './_sdk.js' only)`, ...(line !== undefined ? { line } : {}) });
        }
      } else if (!src.startsWith("@arena/")) {
        // Bare imports of non-@arena packages: reject.
        issues.push({ level: "error", code: "forbidden-import", message: `Import of '${src}' is not allowed`, ...(line !== undefined ? { line } : {}) });
      }
    },
    CallExpression(node) {
      const callee = (node as unknown as { callee: { type: string; name?: string } }).callee;
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      if (callee.type === "Identifier" && (callee.name === "eval" || callee.name === "Function")) {
        issues.push({ level: "error", code: "forbidden-call", message: `'${callee.name}' is not allowed`, ...(line !== undefined ? { line } : {}) });
      }
    },
    ImportExpression(node) {
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      issues.push({ level: "error", code: "dynamic-import", message: `Dynamic import() is not allowed`, ...(line !== undefined ? { line } : {}) });
    },
    NewExpression(node) {
      const callee = (node as unknown as { callee: { type: string; name?: string } }).callee;
      const line = (node as unknown as { loc?: { start: { line: number } } }).loc?.start.line;
      if (callee.type === "Identifier" && callee.name === "Function") {
        issues.push({ level: "error", code: "forbidden-new", message: `'new Function' is not allowed`, ...(line !== undefined ? { line } : {}) });
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

const HERE = dirname(fileURLToPath(import.meta.url));
/** Path to sdk file shipped under bots/samples/_sdk.js. Adjust if validating elsewhere. */
const SDK_PATH_FROM_REPO_ROOT = "bots/samples/_sdk.js";

export interface SmokeRunResult extends ValidationResult {
  responded: boolean;
  stderr?: string;
}

/** Boot the bot, hand it one canned observation, expect a valid action within timeoutMs. */
export async function smokeRun(code: string, opts: { timeoutMs?: number; sdkPath?: string } = {}): Promise<SmokeRunResult> {
  const issues: ValidationIssue[] = [];
  const dir = mkdtempSync(join(tmpdir(), "arena-bot-"));
  try {
    // Resolve SDK file. In tests we point at the repo's bots/samples/_sdk.js.
    const sdkPath = opts.sdkPath ?? findSdk();
    if (!sdkPath) {
      issues.push({ level: "error", code: "sdk-missing", message: "SDK file not found" });
      return { ok: false, issues, responded: false };
    }
    copyFileSync(sdkPath, join(dir, "_sdk.js"));
    const botPath = join(dir, "bot.js");
    writeFileSync(botPath, code, "utf8");

    const bp = spawnBot({ botId: "smoke", scriptPath: botPath });
    const config = mergeConfig({ width: 5, height: 5 });
    const obs: Observation = {
      tick: 0,
      self: { x: 2, y: 2, hp: 100, attack: 10, speed: 1, inventory: [] },
      view: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ kind: "empty" as const }))),
      tickTimeMs: config.tickTimeMs,
    };
    const result = await askBot(bp, obs, opts.timeoutMs ?? 1000);
    killBot(bp);

    if (result.protocolError === "timeout") {
      issues.push({ level: "error", code: "smoke-timeout", message: "Bot did not produce an action within 1s" });
      return { ok: false, issues, responded: false, stderr: bp.stderr };
    }
    if (result.protocolError === "crash") {
      issues.push({ level: "error", code: "smoke-crash", message: "Bot process crashed during smoke run" });
      return { ok: false, issues, responded: false, stderr: bp.stderr };
    }
    if (result.protocolError === "malformed") {
      issues.push({ level: "error", code: "smoke-malformed", message: "Bot wrote malformed JSON to stdout" });
      return { ok: false, issues, responded: true, stderr: bp.stderr };
    }
    return { ok: true, issues, responded: true, stderr: bp.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function findSdk(): string | undefined {
  // Walk up from this file looking for the SDK.
  let cur = HERE;
  for (let i = 0; i < 8; i++) {
    const candidate = join(cur, SDK_PATH_FROM_REPO_ROOT);
    if (existsSync(candidate)) return candidate;
    const next = dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return undefined;
}

export async function validateBot(code: string): Promise<ValidationResult & { stderr?: string }> {
  const stat = validateStatic(code);
  if (!stat.ok) return stat;
  const smoke = await smokeRun(code);
  const result: ValidationResult & { stderr?: string } = {
    ok: stat.ok && smoke.ok,
    issues: [...stat.issues, ...smoke.issues],
  };
  if (smoke.stderr) result.stderr = smoke.stderr;
  return result;
}
