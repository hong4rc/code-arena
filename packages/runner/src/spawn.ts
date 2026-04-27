import type { Subprocess } from "bun";
import type { Action } from "@arena/engine";

export interface BotProcess {
  botId: string;
  proc: Subprocess<"pipe", "pipe", "pipe">;
  /** Buffer for partially-read stdout chunks. */
  buffer: string;
  stderr: string;
  /** True if the process has exited or been killed. */
  closed: boolean;
}

export interface SpawnOptions {
  botId: string;
  scriptPath: string;
  cwd?: string | undefined;
  /** If set, run this exact command instead of `bun <scriptPath>` (used by nsjail wrapper). */
  rawCmd?: string[];
}

export function spawnBot({ botId, scriptPath, cwd, rawCmd }: SpawnOptions): BotProcess {
  const cmd = rawCmd ?? ["bun", scriptPath];
  const proc = Bun.spawn({
    cmd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    ...(cwd !== undefined ? { cwd } : {}),
  });

  const bp: BotProcess = { botId, proc, buffer: "", stderr: "", closed: false };

  // Drain stderr in the background so the pipe doesn't fill.
  void (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bp.stderr += decoder.decode(value);
      }
    } catch {
      /* ignore */
    }
  })();

  void proc.exited.then(() => {
    bp.closed = true;
  });

  return bp;
}

export interface AskResult {
  action: Action | null;
  protocolError?: "timeout" | "crash" | "malformed";
}

/** Send observation to bot's stdin and wait for one action with a timeout. */
export async function askBot(bp: BotProcess, observation: unknown, timeoutMs: number): Promise<AskResult> {
  if (bp.closed) return { action: null, protocolError: "crash" };

  // Send observation as one JSON line.
  try {
    void bp.proc.stdin.write(JSON.stringify(observation) + "\n");
    void bp.proc.stdin.flush();
  } catch {
    return { action: null, protocolError: "crash" };
  }

  // Read one full line from stdout with a wall-clock timeout.
  const reader = bp.proc.stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let line: string;

  try {
    for (;;) {
      const idx = bp.buffer.indexOf("\n");
      if (idx >= 0) {
        line = bp.buffer.slice(0, idx);
        bp.buffer = bp.buffer.slice(idx + 1);
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
        if (bp.buffer.length === 0) return { action: null, protocolError: "timeout" };
        line = bp.buffer;
        bp.buffer = "";
        break;
      }
      bp.buffer += decoder.decode(result.value);
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

export function killBot(bp: BotProcess): void {
  if (bp.closed) return;
  try {
    bp.proc.kill();
  } catch {
    /* ignore */
  }
  bp.closed = true;
}
