import {
  buildObservation,
  createWorld,
  isGameOver,
  mergeConfig,
  placements,
  resolveTick,
  type GameConfig,
  type Observation,
  type ResolvedAction,
  type World,
} from "@arena/engine";

import { askBot, killBot, spawnBot, type BotProcess, type SpawnOptions } from "./spawn.ts";

export interface BotEntry {
  id: string;
  /** Path to user's bot.js (single-file, default-exports `decide`). */
  scriptPath: string;
  /** Path to runtime harness.js that loads the bot and runs the I/O loop. */
  harnessPath: string;
  /** Directory containing bot.js + harness.js, used by nsjail bind-mount. */
  sandboxDir?: string;
}

export type BotSpawn = (opts: SpawnOptions & { sandboxDir?: string }) => BotProcess;

export interface TickReplay {
  tick: number;
  actions: ResolvedAction[];
  observations: Record<string, Observation>;
  worldSnapshot: {
    bots: { id: string; x: number; y: number; hp: number; alive: boolean; inventory: string[] }[];
    items: { id: string; kind: string; x: number; y: number }[];
  };
}

export interface MatchReplay {
  config: GameConfig;
  seed: number;
  bots: string[];
  ticks: TickReplay[];
  finalPlacements: { botId: string; placement: number }[];
}

export interface RunMatchOptions {
  bots: BotEntry[];
  config?: Partial<GameConfig>;
  seed?: number;
  /** Called once per tick after resolution; useful for live streaming. */
  onTick?: (tick: TickReplay) => void | Promise<void>;
  /** Optional spawn override (e.g. nsjail wrapper). Default: plain `bun <script>`. */
  spawn?: BotSpawn;
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

export async function runMatch(opts: RunMatchOptions): Promise<MatchReplay> {
  const config = mergeConfig(opts.config);
  const seed = opts.seed ?? Date.now() & 0xFF_FF;
  const world = createWorld({ botIds: opts.bots.map((b) => b.id), config: opts.config ?? {}, seed });

  const procs: Map<string, BotProcess> = new Map();
  const spawnFn: BotSpawn = opts.spawn ?? ((o) => spawnBot(o));
  for (const b of opts.bots) {
    procs.set(
      b.id,
      spawnFn({
        botId: b.id,
        scriptPath: b.scriptPath,
        harnessPath: b.harnessPath,
        ...(b.sandboxDir ? { sandboxDir: b.sandboxDir } : {}),
      }),
    );
  }

  const ticks: TickReplay[] = [];

  try {
    while (!isGameOver(world)) {
      // Build observations for every alive non-forfeited bot.
      const observations: Record<string, Observation> = {};
      const tasks: Promise<{
        botId: string;
        action: ReturnType<typeof askBot> extends Promise<infer T> ? T : never;
      }>[] = [];

      for (const bot of world.bots.values()) {
        if (!bot.alive || bot.forfeited) continue;
        const obs = buildObservation(world, bot, config);
        observations[bot.id] = obs;
        const bp = procs.get(bot.id);
        if (!bp) continue;
        const ask = async () => {
          const action = await askBot(bp, obs, config.tickTimeMs);
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
  } finally {
    for (const bp of procs.values()) killBot(bp);
  }

  return {
    config,
    seed,
    bots: opts.bots.map((b) => b.id),
    ticks,
    finalPlacements: placements(world),
  };
}
