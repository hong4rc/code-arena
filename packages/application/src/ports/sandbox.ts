import type { Action, Observation } from "@arena/domain";

/**
 * A bot subprocess: stdin/stdout JSON-line protocol with a per-tick timeout.
 * The Sandbox port abstracts the spawn mechanism (subprocess, nsjail, WASM, …).
 */
export interface BotProcess {
  readonly botId: string;
  /** Send one observation, await one action. Returns null on timeout/crash/malformed. */
  ask(observation: Observation, timeoutMs: number): Promise<{ action: Action | null; protocolError?: "timeout" | "crash" | "malformed" }>;
  /**
   * Inject persistent params into the bot's `state.params` BEFORE the first
   * tick. No-op if the bot doesn't read them. Optional — sandboxes may skip.
   */
  init?(params: unknown): void;
  /**
   * After the last tick, ask the bot for its final `state.params`. Returns
   * null on timeout/crash, or if the bot didn't set anything. Optional.
   */
  finalize?(info: unknown, timeoutMs: number): Promise<unknown>;
  /** Buffered stderr captured for this bot (visible to its owner only). */
  readonly stderr: string;
  kill(): void;
}

export interface SandboxSpawnRequest {
  botId: string;
  /** Bot source code (single-file). */
  code: string;
}

export interface Sandbox {
  /** Boot a bot and return a process handle. May write tmp files; caller doesn't care. */
  spawn(req: SandboxSpawnRequest): Promise<BotProcess>;
}
