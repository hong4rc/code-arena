import type { User, UserRepo } from "@arena/application";
import { eq, getDb, users, type Db } from "@arena/db";


export class DrizzleUserRepo implements UserRepo {
  private _db?: Db;
  constructor(db?: Db) { if (db) this._db = db; }
  private get db(): Db { return this._db ?? getDb(); }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async create(input: { id?: string; email: string; name?: string | null; role?: "user" | "admin" }): Promise<User> {
    const [row] = await this.db.insert(users).values({
      ...(input.id ? { id: input.id } : {}),
      email: input.email,
      name: input.name ?? null,
      role: input.role ?? "user",
    }).returning();
    return this.toDomain(row!);
  }

  private toDomain(row: typeof users.$inferSelect): User {
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }
}
