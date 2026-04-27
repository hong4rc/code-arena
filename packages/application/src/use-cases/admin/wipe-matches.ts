import type { MatchRepo, User } from "../../ports/index.ts";

export interface WipeMatchesDeps {
  matches: MatchRepo;
}

/** Hard-deletes ALL matches (and their replays/participants). Admin only. */
export class WipeMatchesUseCase {
  constructor(private deps: WipeMatchesDeps) {}

  async execute(input: { requestedBy: User }): Promise<{ removed: number }> {
    if (input.requestedBy.role !== "admin") throw new Error("FORBIDDEN");
    const removed = await this.deps.matches.deleteAll();
    return { removed };
  }
}
