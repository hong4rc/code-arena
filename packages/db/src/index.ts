import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.ts";

export * from "./schema.ts";
export { uuidv7 } from "./uuidv7.ts";
export { sql, eq, and, or, desc, asc, inArray, gt, gte, lt, lte, isNull } from "drizzle-orm";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  _client = postgres(url, { max: 10, prepare: false });
  _db = drizzle(_client, { schema });
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
  }
}

export type Db = ReturnType<typeof getDb>;
