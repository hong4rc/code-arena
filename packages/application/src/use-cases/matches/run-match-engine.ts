import {
  buildObservation,
  createWorld,
  isGameOver,
  mergeConfig,
  placements,
  resolveTick,
  type GameConfig,
  type Observation,
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
}

export interface RunMatchEngineOptions {
  bots: BotProcess[];
  config?: Partial<GameConfig>;
  seed: number;
  onTick?: (tick: TickReplay) => void | Promise<void>;
}

function snapshot(world: World): TickReplay["worldSnapshot"] {
  return {
    bots: [...world.bots.values()].map((b) => ({
      id: b.id,
      x: b.pos.x,
      y: b.pos.y,
      hp: b.hp,
      alive: b.alive,
      inventory: [...b.inventory],
    })),
    items: [...world.items.values()].map((i) => ({ id: i.id, kind: i.kind, x: i.pos.x, y: i.pos.y })),
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

  while (!isGameOver(world)) {
    const observations: Record<string, Observation> = {};
    const tasks: Promise<{ botId: string; action: Awaited<ReturnType<BotProcess["ask"]>> }>[] = [];

    for (const bot of world.bots.values()) {
      if (!bot.alive || bot.forfeited) continue;
      const obs = buildObservation(world, bot, config);
      observations[bot.id] = obs;
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
      observations,
      worldSnapshot: snapshot(world),
    };
    ticks.push(replay);
    if (opts.onTick) await opts.onTick(replay);
  }

  return {
    config,
    seed: opts.seed,
    bots: opts.bots.map((b) => b.botId),
    ticks,
    finalPlacements: placements(world),
  };
}
