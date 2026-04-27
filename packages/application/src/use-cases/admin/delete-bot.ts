import type { BotRepo, User } from "../../ports/index.ts";

export interface DeleteBotDeps {
  bots: BotRepo;
}

/** Hard-deletes a bot and everything that references it. Owner or admin. */
export class DeleteBotUseCase {
  constructor(private deps: DeleteBotDeps) {}

  async execute(input: { botId: string; requestedBy: User }): Promise<void> {
    const bot = await this.deps.bots.findById(input.botId);
    if (!bot) throw new Error("NOT_FOUND");
    const isAdmin = input.requestedBy.role === "admin";
    const isOwner = bot.ownerId === input.requestedBy.id;
    if (!isAdmin && !isOwner) throw new Error("FORBIDDEN");
    if (bot.isOfficial && !isAdmin) throw new Error("FORBIDDEN");
    await this.deps.bots.delete(input.botId);
  }
}
