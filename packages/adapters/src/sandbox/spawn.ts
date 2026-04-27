import type { Action, Observation } from "@arena/domain";

import type { Subprocess } from "bun";

export interface SpawnedProcess {
  proc: Subprocess<"pipe", "pipe", "pipe">;
  buffer: string;
  stderr: string;
  closed: boolean;
}

export interface SpawnArgs {
  cmd: string[];
  cwd?: string | undefined;
}

/** Low-level Bun subprocess spawn with line-buffered stdio. */
export function spawn({ cmd, cwd }: SpawnArgs): SpawnedProcess {
  const proc = Bun.spawn({
    cmd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    ...(cwd === undefined ? {} : { cwd }),
  });
  const sp: SpawnedProcess = { proc, buffer: "", stderr: "", closed: false };

  // Drain stderr to keep the pipe from filling.
  void (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sp.stderr += decoder.decode(value);
      }
    } catch { /* ignore */ }
  })();

  void proc.exited.then(() => { sp.closed = true; });
  return sp;
}

export interface AskResult {
  action: Action | null;
  protocolError?: "timeout" | "crash" | "malformed";
}

/** Send one observation and wait for one action with a wall-clock timeout. */
export async function ask(sp: SpawnedProcess, observation: Observation, timeoutMs: number): Promise<AskResult> {
  if (sp.closed) return { action: null, protocolError: "crash" };

  try {
    void sp.proc.stdin.write(JSON.stringify(observation) + "\n");
    void sp.proc.stdin.flush();
  } catch {
    return { action: null, protocolError: "crash" };
  }

  const reader = sp.proc.stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let line: string;

  try {
    for (;;) {
      const idx = sp.buffer.indexOf("\n");
      if (idx !== -1) {
        line = sp.buffer.slice(0, idx);
        sp.buffer = sp.buffer.slice(idx + 1);
        break;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { action: null, protocolError: "timeout" };
      const readPromise = reader.read();
      const timer = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      );
      const result = await Promise.race([readPromise, timer]);
      if (result.done) {
        if (sp.buffer.length === 0) return { action: null, protocolError: "timeout" };
        line = sp.buffer;
        sp.buffer = "";
        break;
      }
      sp.buffer += decoder.decode(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const parsed = JSON.parse(line) as Action;
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { type: unknown }).type !== "string") {
      return { action: null, protocolError: "malformed" };
    }
    return { action: parsed };
  } catch {
    return { action: null, protocolError: "malformed" };
  }
}

export function kill(sp: SpawnedProcess): void {
  if (sp.closed) return;
  try { sp.proc.kill(); } catch { /* ignore */ }
  sp.closed = true;
}

/**
 * Send the bot a one-line `__init__` message before any observation. The
 * harness hydrates `state.params` from this, so bots see persisted params on
 * the very first `decide()` call.
 */
export function sendInit(sp: SpawnedProcess, params: unknown): void {
  if (sp.closed) return;
  try {
    void sp.proc.stdin.write(JSON.stringify({ __init__: true, params }) + "\n");
    void sp.proc.stdin.flush();
  } catch { /* ignore — caller will see closed sandbox */ }
}

/**
 * Send the bot a one-line `__finalize__` message after the last tick and read
 * back its `state.params`. Returns null if the bot crashed, timed out, or
 * never wrote params. `info` is delivered to the bot's optional `learn(info,
 * state)` export — typical fields: `placement`, `won`, `tick`, `damage`.
 */
export async function askFinalize(sp: SpawnedProcess, info: unknown, timeoutMs: number): Promise<unknown> {
  if (sp.closed) return null;
  try {
    void sp.proc.stdin.write(JSON.stringify({ __finalize__: true, info }) + "\n");
    void sp.proc.stdin.flush();
  } catch { return null; }

  const reader = sp.proc.stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let line: string;
  try {
    for (;;) {
      const idx = sp.buffer.indexOf("\n");
      if (idx !== -1) {
        line = sp.buffer.slice(0, idx);
        sp.buffer = sp.buffer.slice(idx + 1);
        break;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const readPromise = reader.read();
      const timer = new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      );
      const result = await Promise.race([readPromise, timer]);
      if (result.done) {
        if (sp.buffer.length === 0) return null;
        line = sp.buffer;
        sp.buffer = "";
        break;
      }
      sp.buffer += decoder.decode(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const parsed = JSON.parse(line) as { __params__?: unknown };
    return parsed.__params__ ?? null;
  } catch {
    return null;
  }
}
