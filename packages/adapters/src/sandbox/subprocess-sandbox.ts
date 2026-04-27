import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BotProcess, Sandbox, SandboxSpawnRequest } from "@arena/application";
import type { Action, Observation } from "@arena/domain";

import { findHarness } from "./harness-path.ts";
import { ask, askFinalize, kill, sendInit, spawn, type SpawnedProcess } from "./spawn.ts";

/** A BotProcess backed by a single OS subprocess + harness, no nsjail. */
class SubprocessBot implements BotProcess {
  constructor(
    public readonly botId: string,
    private sp: SpawnedProcess,
    private cleanup: () => void,
  ) {}

  ask(observation: Observation, timeoutMs: number): Promise<{ action: Action | null; protocolError?: "timeout" | "crash" | "malformed" }> {
    return ask(this.sp, observation, timeoutMs);
  }

  init(params: unknown): void { sendInit(this.sp, params); }
  finalize(info: unknown, timeoutMs: number): Promise<unknown> { return askFinalize(this.sp, info, timeoutMs); }

  get stderr(): string { return this.sp.stderr; }

  kill(): void {
    kill(this.sp);
    this.cleanup();
  }
}

/**
 * Sandbox implementation that runs each bot as a plain `bun harness.js bot.js`
 * subprocess in a tmp directory. Suitable for dev (macOS) and as the fallback
 * when nsjail isn't available on the host kernel.
 */
export class SubprocessSandbox implements Sandbox {
  // eslint-disable-next-line @typescript-eslint/require-await
  async spawn(req: SandboxSpawnRequest): Promise<BotProcess> {
    const dir = mkdtempSync(join(tmpdir(), `arena-${req.botId.slice(0, 8)}-`));
    const harnessSrc = findHarness();
    const harnessPath = join(dir, "harness.js");
    if (existsSync(harnessSrc)) copyFileSync(harnessSrc, harnessPath);
    const scriptPath = join(dir, "bot.js");
    writeFileSync(scriptPath, req.code, "utf8");

    const sp = spawn({ cmd: ["bun", harnessPath, scriptPath], cwd: dir });
    return new SubprocessBot(req.botId, sp, () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });
  }
}
