import type { BotRepo, MatchRepo, QueueRepo, RatingRepo, SeasonRepo } from "../../ports/index.ts";

export interface ScheduleAutoMatchesConfig {
  matchesPerCycle: number;
  matchSize: number;
  /** Skip cycle entirely if active pool < this many bots. */
  minBotsToRun: number;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleAutoMatchesConfig = {
  matchesPerCycle: 3,
  matchSize: 10,
  minBotsToRun: 20,
};

export interface ScheduleAutoMatchesDeps {
  bots: BotRepo;
  matches: MatchRepo;
  ratings: RatingRepo;
  seasons: SeasonRepo;
  queue: QueueRepo;
  /** Random source — defaults to Math.random; tests inject deterministic values. */
  random?: () => number;
}

interface PoolEntry { botId: string; rating: number; queued: boolean }

function pickBand(pool: PoolEntry[], n: number, random: () => number): string[] {
  if (pool.length < n) return [];
  const sorted = [...pool].sort((a, b) => a.rating - b.rating);
  const start = Math.floor(random() * (sorted.length - n + 1));
  return sorted.slice(start, start + n).map((p) => p.botId);
}

function pickRandomFrom(pool: PoolEntry[], n: number, random: () => number): string[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n).map((p) => p.botId);
}

export class ScheduleAutoMatchesUseCase {
  constructor(private deps: ScheduleAutoMatchesDeps, private config: ScheduleAutoMatchesConfig = DEFAULT_SCHEDULE_CONFIG) {}

  async execute(): Promise<{ created: number }> {
    const random = this.deps.random ?? Math.random;
    const season = await this.deps.seasons.findActive();
    if (!season) return { created: 0 };

    const active = await this.deps.bots.findActive();
    if (active.length < this.config.minBotsToRun) return { created: 0 };

    const queueIds = new Set(await this.deps.queue.enqueued());
    const ratings = await this.deps.ratings.findBySeason(season.id, active.map((b) => b.id));
    const ratingMap = new Map(ratings.map((r) => [r.botId, r.rating]));

    let pool: PoolEntry[] = active.map((b) => ({
      botId: b.id,
      rating: ratingMap.get(b.id) ?? 1500,
      queued: queueIds.has(b.id),
    }));

    let created = 0;
    for (let m = 0; m < this.config.matchesPerCycle; m++) {
      if (pool.length < this.config.matchSize) break;
      const picked = m < 2
        ? pickBand(
            [...pool.filter((p) => p.queued), ...pool.filter((p) => !p.queued)],
            this.config.matchSize,
            random,
          )
        : pickRandomFrom(pool, this.config.matchSize, random);
      if (picked.length < this.config.matchSize) break;
      pool = pool.filter((p) => !picked.includes(p.botId));

      const seed = Math.floor(random() * 0x7F_FF_FF_FF);
      const match = await this.deps.matches.create({ seasonId: season.id, kind: "auto", seed });
      for (const botId of picked) {
        const version = await this.deps.bots.latestRunnableVersion(botId);
        if (!version) continue;
        await this.deps.matches.addParticipant({ matchId: match.id, botId, botVersionId: version.id });
      }
      await this.deps.queue.drain(picked);
      created += 1;
    }

    return { created };
  }
}
