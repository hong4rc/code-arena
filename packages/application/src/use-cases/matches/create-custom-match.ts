import type { BotRepo, MatchRepo, SeasonRepo, User } from "../../ports/index.ts";

export interface CreateCustomMatchDeps {
  bots: BotRepo;
  matches: MatchRepo;
  seasons: SeasonRepo;
  random?: () => number;
}

export interface CreateCustomMatchInput {
  botIds: string[];
  requestedBy: User;
}

export interface CreateCustomMatchResult {
  matchId: string;
}

const MIN_BOTS = 2;
const MAX_BOTS = 10;

/**
 * Custom match: user-curated bot list. Doesn't affect rating (kind='custom').
 *
 * Eligibility:
 *  - Bot must have a runnable version (`latestRunnableVersion` returns non-null).
 *  - Caller must own the bot OR the bot must be `is_public` / `is_official`.
 *  - At least 2, at most 10 bots; duplicates rejected.
 */
export class CreateCustomMatchUseCase {
  constructor(private deps: CreateCustomMatchDeps) {}

  async execute(input: CreateCustomMatchInput): Promise<CreateCustomMatchResult> {
    const { botIds, requestedBy } = input;
    if (botIds.length < MIN_BOTS) throw new Error("TOO_FEW_BOTS");
    if (botIds.length > MAX_BOTS) throw new Error("TOO_MANY_BOTS");
    if (new Set(botIds).size !== botIds.length) throw new Error("DUPLICATE_BOTS");

    // Validate eligibility + collect runnable versions in parallel.
    const checks = await Promise.all(botIds.map(async (id) => {
      const bot = await this.deps.bots.findById(id);
      if (!bot) throw new Error(`BOT_NOT_FOUND:${id}`);
      const ownedOrPublic = bot.ownerId === requestedBy.id || bot.isPublic || bot.isOfficial;
      if (!ownedOrPublic) throw new Error(`FORBIDDEN_BOT:${id}`);
      const version = await this.deps.bots.latestRunnableVersion(id);
      if (!version) throw new Error(`BOT_NOT_RUNNABLE:${id}`);
      return { botId: id, botVersionId: version.id };
    }));

    const random = this.deps.random ?? Math.random;
    const season = await this.deps.seasons.findActive();
    const seed = Math.floor(random() * 0x7F_FF_FF_FF);
    const match = await this.deps.matches.create({ seasonId: season?.id ?? null, kind: "custom", seed });
    for (const c of checks) {
      await this.deps.matches.addParticipant({ matchId: match.id, botId: c.botId, botVersionId: c.botVersionId });
    }
    return { matchId: match.id };
  }
}
