import type { User, UserRepo } from "../../ports/index.ts";

export interface GetOrCreateUserInput {
  authId: string;
  email: string;
  name?: string | null;
}

export interface GetOrCreateUserDeps {
  users: UserRepo;
}

export class GetOrCreateUserUseCase {
  constructor(private deps: GetOrCreateUserDeps) {}

  async execute(input: GetOrCreateUserInput): Promise<User> {
    // Better Auth populates `id` to its own value; we look up by id (which Better Auth used to insert).
    const found = await this.deps.users.findById(input.authId);
    if (found) return found;
    return this.deps.users.create({ id: input.authId, email: input.email, name: input.name ?? null });
  }
}
