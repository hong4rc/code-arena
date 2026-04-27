import {
  buildObservation,
  createWorld,
  isGameOver,
  mergeConfig,
  placements,
  resolveTick,
  type GameConfig,
  type TickReplay,
  type World,
} from "@arena/domain";

import type { BotProcess } from "../../ports/index.ts";

export interface MatchReplay {
  config: GameConfig;
  seed: number;
  bots: string[];
  ticks: TickReplay[];
  finalPlacements: { botId: string; placement: number }[];
  /** Per-bot summary stats at end of match — used to populate match_participants. */
  finalStats: { botId: string; damageDealt: number; itemsPicked: number }[];
  /** Per-bot final state.params (persisted to bot_params). null if bot didn't reply. */
  finalParams: Record<string, unknown>;
}

export interface RunMatchEngineOptions {
  bots: BotProcess[];
  config?: Partial<GameConfig>;
  seed: number;
  onTick?: (tick: TickReplay) => void | Promise<void>;
  /** Persistent params per bot (from `bot_params`). Injected before first tick. */
  initialParams?: Record<string, unknown>;
  /** Wall-clock timeout for the bot's __finalize__ reply. */
  finalizeTimeoutMs?: number;
}

function snapshot(world: World): TickReplay["worldSnapshot"] {
  return {
    bots: [...world.bots.values()].map((b) => ({
      id: b.id,
      x: b.pos.x,
      y: b.pos.y,
      size: b.size,
      hp: b.hp,
      alive: b.alive,
      inventory: [...b.inventory],
    })),
    items: [...world.items.values()].map((i) => ({ id: i.id, kind: i.kind, x: i.pos.x, y: i.pos.y })),
    bullets: [...world.bullets.values()].map((b) => ({
      id: b.id, x: b.pos.x, y: b.pos.y, vx: b.vx, vy: b.vy, ownerId: b.ownerId,
    })),
    zone: { ...world.zone },
    nextZone: world.nextZone ? { ...world.nextZone } : null,
    nextShrinkAtTick: world.nextShrinkAtTick,
  };
}

/**
 * Drive the engine tick loop against a set of already-spawned BotProcesses.
 * Pure orchestration: no DB, no file system, no side effects beyond what the
 * BotProcess instances themselves do.
 */
export async function runMatchEngine(opts: RunMatchEngineOptions): Promise<MatchReplay> {
  const config = mergeConfig(opts.config);
  const world = createWorld({
    botIds: opts.bots.map((b) => b.botId),
    config: opts.config ?? {},
    seed: opts.seed,
  });

  const procById = new Map(opts.bots.map((b) => [b.botId, b]));
  const ticks: TickReplay[] = [];

  // Hydrate persistent params before the first observation. Bots that don't
  // care about params will simply ignore the __init__ message.
  const initialParams = opts.initialParams ?? {};
  for (const proc of opts.bots) {
    proc.init?.(initialParams[proc.botId] ?? {});
  }

  while (!isGameOver(world)) {
    const tasks: Promise<{ botId: string; action: Awaited<ReturnType<BotProcess["ask"]>> }>[] = [];

    for (const bot of world.bots.values()) {
      if (!bot.alive || bot.forfeited) continue;
      const obs = buildObservation(world, bot, config);
      const proc = procById.get(bot.id);
      if (!proc) continue;
      const ask = async () => {
        const action = await proc.ask(obs, config.tickTimeMs);
        return { botId: bot.id, action };
      };
      tasks.push(ask());
    }

    const responses = await Promise.all(tasks);
    const inputs = responses.map((r) => ({
      botId: r.botId,
      action: r.action.action ?? { type: "WAIT" as const },
      ...(r.action.protocolError ? { protocolError: r.action.protocolError } : {}),
    }));

    const tickNum = world.tick;
    const resolved = resolveTick(world, inputs, config);
    const replay: TickReplay = {
      tick: tickNum,
      actions: resolved,
      worldSnapshot: snapshot(world),
    };
    ticks.push(replay);
    if (opts.onTick) await opts.onTick(replay);
  }

  // Drain final params from each bot. Failures (timeout/crash) yield null,
  // which the runner reads as "don't update params for this bot".
  // We pass each bot its own placement / outcome so optional `learn(info,
  // state)` exports can update params even if the bot died mid-match
  // (no further `decide` calls happen after death).
  const finalizeTimeoutMs = opts.finalizeTimeoutMs ?? 500;
  const finalPlacements = placements(world);
  const placementByBot = new Map(finalPlacements.map((p) => [p.botId, p.placement]));
  const finalParams: Record<string, unknown> = {};
  await Promise.all(opts.bots.map(async (proc) => {
    if (!proc.finalize) { finalParams[proc.botId] = null; return; }
    const bot = world.bots.get(proc.botId);
    const place = placementByBot.get(proc.botId) ?? opts.bots.length;
    const info = {
      placement: place,
      won: place === 1,
      tick: world.tick,
      hp: bot?.hp ?? 0,
      damageDealt: bot?.damageDealt ?? 0,
      itemsPicked: bot?.itemsPicked ?? 0,
      totalBots: opts.bots.length,
    };
    try { finalParams[proc.botId] = await proc.finalize(info, finalizeTimeoutMs); }
    catch { finalParams[proc.botId] = null; }
  }));

  return {
    config,
    seed: opts.seed,
    bots: opts.bots.map((b) => b.botId),
    ticks,
    finalPlacements,
    finalStats: [...world.bots.values()].map((b) => ({
      botId: b.id, damageDealt: b.damageDealt, itemsPicked: b.itemsPicked,
    })),
    finalParams,
  };
}
