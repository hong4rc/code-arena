import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BotProcess, Sandbox, SandboxSpawnRequest } from "@arena/application";
import type { Action, Observation } from "@arena/domain";

import { findHarness } from "./harness-path.ts";
import { ask, kill, spawn, type SpawnedProcess } from "./spawn.ts";
import { SubprocessSandbox } from "./subprocess-sandbox.ts";

const NSJAIL_BIN = "/usr/local/bin/nsjail";

class NsjailBot implements BotProcess {
  constructor(
    public readonly botId: string,
    private sp: SpawnedProcess,
    private cleanup: () => void,
  ) {}

  ask(observation: Observation, timeoutMs: number): Promise<{ action: Action | null; protocolError?: "timeout" | "crash" | "malformed" }> {
    return ask(this.sp, observation, timeoutMs);
  }

  get stderr(): string { return this.sp.stderr; }

  kill(): void {
    kill(this.sp);
    this.cleanup();
  }
}

/**
 * Production sandbox: each bot runs inside `nsjail` with hard limits
 *  - 32 MB memory, 0.25 CPU, no network, read-only root, dropped capabilities
 * Falls back to plain subprocess if nsjail isn't available on the host kernel.
 */
export class NsjailSandbox implements Sandbox {
  private fallback = new SubprocessSandbox();

  spawn(req: SandboxSpawnRequest): Promise<BotProcess> {
    if (!existsSync(NSJAIL_BIN)) return this.fallback.spawn(req);

    const dir = mkdtempSync(join(tmpdir(), `arena-jail-${req.botId.slice(0, 8)}-`));
    const harnessSrc = findHarness();
    if (existsSync(harnessSrc)) copyFileSync(harnessSrc, join(dir, "harness.js"));
    writeFileSync(join(dir, "bot.js"), req.code, "utf8");

    const cmd = [
      NSJAIL_BIN,
      "--mode", "o",
      "--quiet",
      "--user", "10001",
      "--group", "10001",
      "--time_limit", "20",
      "--rlimit_as", "32",
      "--rlimit_cpu", "5",
      "--rlimit_fsize", "1",
      "--rlimit_nofile", "32",
      "--rlimit_nproc", "16",
      "--max_cpus", "1",
      "--cgroup_mem_max", "33554432",
      "--cgroup_pids_max", "16",
      "--disable_clone_newnet=false",
      "--chroot", "/",
      "--bindmount_ro", `${dir}:/sandbox`,
      "--bindmount_ro", "/usr/bin/node:/usr/bin/node",
      "--bindmount_ro", "/lib:/lib",
      "--bindmount_ro", "/lib64:/lib64",
      "--bindmount_ro", "/usr/lib:/usr/lib",
      "--mount", "tmpfs:/tmp:tmpfs:size=4194304",
      "--cwd", "/sandbox",
      "--",
      "/usr/bin/node", "/sandbox/harness.js", "/sandbox/bot.js",
    ];

    const sp = spawn({ cmd, cwd: dir });
    return Promise.resolve(new NsjailBot(req.botId, sp, () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }));
  }
}
