/* eslint-disable no-console */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

console.log("Running migrations…");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await client.end();
