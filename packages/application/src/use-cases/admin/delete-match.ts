import type { MatchRepo, User } from "../../ports/index.ts";

export interface DeleteMatchDeps {
  matches: MatchRepo;
}

/** Hard-deletes one match (cascades to participants + replay). Admin only. */
export class DeleteMatchUseCase {
  constructor(private deps: DeleteMatchDeps) {}

  async execute(input: { matchId: string; requestedBy: User }): Promise<void> {
    if (input.requestedBy.role !== "admin") throw new Error("FORBIDDEN");
    await this.deps.matches.deleteById(input.matchId);
  }
}
