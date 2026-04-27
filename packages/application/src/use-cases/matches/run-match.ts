import { INITIAL_RATING, updateMatchRatings } from "@arena/domain";

import { runMatchEngine } from "./run-match-engine.ts";

import type {
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
  /** Floor for tick-pacing (ms) so live spectators can follow along. */
  tickFloorMs?: number;
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

    const tickFloor = this.deps.tickFloorMs ?? 700;

    try {
      const replay = await runMatchEngine({
        bots: procs,
        seed: match.seed,
        onTick: async (tick) => {
          this.deps.events.publishTick(matchId, tick);
          await new Promise<void>((r) => setTimeout(r, tickFloor));
        },
      });

      await this.deps.matches.saveReplay(matchId, replay.ticks);

      const placementByBotId = new Map(replay.finalPlacements.map((p) => [p.botId, p.placement]));
      const lastSnap = replay.ticks.at(-1)?.worldSnapshot.bots ?? [];
      const hpById = new Map(lastSnap.map((b) => [b.id, b.hp]));

      for (const proc of procs) {
        await this.deps.matches.setParticipantOutcome({
          matchId,
          botId: proc.botId,
          placement: placementByBotId.get(proc.botId) ?? procs.length,
          finalHp: hpById.get(proc.botId) ?? 0,
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
