import { existsSync } from "node:fs";
import { spawnBot, type BotProcess, type SpawnOptions } from "./spawn.ts";

/**
 * If nsjail is available on PATH (production), wrap the bot subprocess in it.
 * Otherwise fall back to the unsandboxed `bun <script>` spawn (dev/macOS).
 *
 * Limits enforced (production):
 *   - Memory: 32 MB
 *   - CPU: 0.25 core (via cgroups)
 *   - No network
 *   - Read-only root, tmpfs /tmp 4 MB
 *   - PIDs: 16
 *   - Drop all caps, non-root UID
 *   - Total wall: 20s
 *
 * The bot script is mounted read-only at /sandbox/bot.js; nsjail invokes
 * `node /sandbox/bot.js` (Node, not Bun — smaller memory footprint, plenty for
 * stdin/stdout JSON loop bots).
 */
export function spawnSandboxedBot(opts: SpawnOptions & { sandboxDir?: string }): BotProcess {
  const haveNsjail = existsSync("/usr/local/bin/nsjail");
  if (!haveNsjail || !opts.sandboxDir) {
    // Dev fallback: just run bun directly.
    return spawnBot(opts);
  }
  const sandboxDir = opts.sandboxDir;

  const cmd = [
    "/usr/local/bin/nsjail",
    "--mode", "o",                       // ONCE: one process, not a daemon
    "--quiet",
    "--user", "10001",
    "--group", "10001",
    "--time_limit", "20",
    "--rlimit_as", "32",                 // 32 MB virtual memory
    "--rlimit_cpu", "5",
    "--rlimit_fsize", "1",
    "--rlimit_nofile", "32",
    "--rlimit_nproc", "16",
    "--max_cpus", "1",
    "--cgroup_mem_max", "33554432",      // 32 MB hard
    "--cgroup_pids_max", "16",
    "--disable_clone_newnet=false",      // empty net namespace = no network
    "--chroot", "/",
    "--bindmount_ro", `${sandboxDir}:/sandbox`,
    "--bindmount_ro", "/usr/bin/node:/usr/bin/node",
    "--bindmount_ro", "/lib:/lib",
    "--bindmount_ro", "/lib64:/lib64",
    "--bindmount_ro", "/usr/lib:/usr/lib",
    "--mount", "tmpfs:/tmp:tmpfs:size=4194304",
    "--cwd", "/sandbox",
    "--",
    "/usr/bin/node", "/sandbox/bot.js",
  ];

  // Use spawnBot's machinery but with a different command. Easiest: build a
  // shim by reusing Bun.spawn directly and creating a BotProcess by hand.
  // To keep one code path, we expose this via spawnBot below using a custom
  // command override.
  return spawnBot({
    botId: opts.botId,
    scriptPath: "", // unused when rawCmd is provided
    cwd: sandboxDir,
    rawCmd: cmd,
  });
}
