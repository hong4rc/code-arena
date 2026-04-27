import { INITIAL_RATING, updateMatchRatings } from "@arena/domain";

import { runMatchEngine } from "./run-match-engine.ts";

import type {
  BotParamsRepo,
  BotProcess,
  BotRepo,
  Clock,
  EventPublisher,
  MatchRepo,
  RatingRepo,
  Sandbox,
} from "../../ports/index.ts";


export interface RunMatchDeps {
  bots: BotRepo;
  matches: MatchRepo;
  ratings: RatingRepo;
  sandbox: Sandbox;
  events: EventPublisher;
  clock: Clock;
  /** Optional — when present, persistent params load before match and save after. */
  botParams?: BotParamsRepo;
  /** Floor for tick-pacing (ms) so live spectators can follow along. */
  tickFloorMs?: number;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Pull a pending match, spawn bots, run the engine, persist replay, update ratings. */
export class RunMatchUseCase {
  constructor(private deps: RunMatchDeps) {}

  async execute(matchId: string): Promise<void> {
    const match = await this.deps.matches.findById(matchId);
    if (!match) return;

    await this.deps.matches.markRunning(matchId, this.deps.clock.now());

    const participants = await this.deps.matches.participants(matchId);
    const procs: BotProcess[] = [];

    for (const p of participants) {
      const version = await this.deps.bots.latestRunnableVersion(p.botId);
      if (!version) continue;
      const proc = await this.deps.sandbox.spawn({ botId: p.botId, code: version.code });
      procs.push(proc);
    }

    if (procs.length < 2) {
      await this.deps.matches.markFailed(matchId, this.deps.clock.now());
      return;
    }

    // Load persistent params for each bot (if the repo is wired in). Bots that
    // never saved any get an empty `{}`. The runner snapshots whatever's in
    // state.params at end-of-match — so even bots that don't read params will
    // start contributing rows once they ship a save.
    const initialParams: Record<string, unknown> = {};
    if (this.deps.botParams) {
      await Promise.all(procs.map(async (proc) => {
        const row = await this.deps.botParams!.latest(proc.botId);
        initialParams[proc.botId] = row?.params ?? {};
      }));
    }

    // Tick floor for live spectator pacing. Default 0 (run as fast as the
    // engine + bot subprocesses allow). Set in composition root if you want
    // to slow live ticks for human-watchable replays.
    const tickFloor = this.deps.tickFloorMs ?? 0;

    try {
      const replay = await runMatchEngine({
        bots: procs,
        seed: match.seed,
        initialParams,
        onTick: async (tick) => {
          this.deps.events.publishTick(matchId, tick);
          if (tickFloor > 0) await new Promise<void>((r) => setTimeout(r, tickFloor));
        },
      });

      await this.deps.matches.saveReplay(matchId, replay.ticks);

      const placementByBotId = new Map(replay.finalPlacements.map((p) => [p.botId, p.placement]));
      const lastSnap = replay.ticks.at(-1)?.worldSnapshot.bots ?? [];
      const hpById = new Map(lastSnap.map((b) => [b.id, b.hp]));
      const statsById = new Map(replay.finalStats.map((s) => [s.botId, s]));

      for (const proc of procs) {
        const stats = statsById.get(proc.botId);
        await this.deps.matches.setParticipantOutcome({
          matchId,
          botId: proc.botId,
          placement: placementByBotId.get(proc.botId) ?? procs.length,
          finalHp: hpById.get(proc.botId) ?? 0,
          damageDealt: stats?.damageDealt ?? 0,
          itemsPicked: stats?.itemsPicked ?? 0,
        });
      }

      // Ranked auto matches update Glicko-2 ratings.
      if (match.kind === "auto" && match.seasonId) {
        const seasonId = match.seasonId;
        const botIds = procs.map((p) => p.botId);
        const existing = await this.deps.ratings.findBySeason(seasonId, botIds);
        const existingByBot = new Map(existing.map((r) => [r.botId, r]));
        const ratingInputs = procs.map((p) => ({
          botId: p.botId,
          rating: existingByBot.get(p.botId)
            ? { rating: existingByBot.get(p.botId)!.rating, rd: existingByBot.get(p.botId)!.rd, vol: existingByBot.get(p.botId)!.vol }
            : { ...INITIAL_RATING },
          placement: placementByBotId.get(p.botId) ?? procs.length,
        }));
        const updated = updateMatchRatings(ratingInputs);

        for (const [botId, g] of updated) {
          const before = existingByBot.get(botId);
          await this.deps.ratings.upsert({
            botId,
            seasonId,
            rating: g.rating,
            rd: g.rd,
            vol: g.vol,
            games: (before?.games ?? 0) + 1,
          });
          const delta = g.rating - (before?.rating ?? INITIAL_RATING.rating);
          await this.deps.matches.setParticipantOutcome({
            matchId,
            botId,
            placement: placementByBotId.get(botId) ?? procs.length,
            finalHp: hpById.get(botId) ?? 0,
            ratingDelta: delta,
          });
        }
      }

      // Persist updated bot params (one new version per bot whose params
      // changed — null replies mean "no save", e.g. crashed/legacy bot).
      // Each save is logged so it's visible from the dev console / runner logs
      // why a bot's behaviour evolved across matches.
      if (this.deps.botParams) {
        for (const [botId, params] of Object.entries(replay.finalParams)) {
          if (params === null || params === undefined) continue;
          const beforeStr = JSON.stringify(initialParams[botId] ?? {});
          const afterStr = JSON.stringify(params);
          if (beforeStr === afterStr) continue;
          const { version } = await this.deps.botParams.saveNewVersion(botId, params);
          // eslint-disable-next-line no-console
          console.log(`[learn] match=${matchId.slice(0, 8)} bot=${botId.slice(0, 8)} v${version} params=${truncate(afterStr, 240)}`);
        }
      }

      await this.deps.matches.markDone(matchId, this.deps.clock.now());
    } catch (error) {
       
      console.error(`match ${matchId} failed:`, error);
      await this.deps.matches.markFailed(matchId, this.deps.clock.now());
    } finally {
      this.deps.events.endChannel(matchId);
      for (const proc of procs) proc.kill();
    }
  }
}
