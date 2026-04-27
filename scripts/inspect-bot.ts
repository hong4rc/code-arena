#!/usr/bin/env bun
/* eslint-disable no-console */
// Inspect a DB bot — code + latest params shape.
//   bun scripts/inspect-bot.ts <bot-uuid>
import { DrizzleBotRepo, DrizzleBotParamsRepo } from "@arena/adapters";

const id = process.argv[2];
if (!id) { console.error("Usage: bun scripts/inspect-bot.ts <uuid>"); process.exit(2); }

const bots = new DrizzleBotRepo();
const params = new DrizzleBotParamsRepo();
const bot = await bots.findById(id);
if (!bot) { console.error("not found"); process.exit(3); }

const ver = await bots.latestRunnableVersion(id);
const p = await params.latest(id);

console.log(`name: ${bot.name}  official: ${bot.isOfficial}  public: ${bot.isPublic}`);
console.log(`code: ${ver?.code.split("\n").length ?? 0} lines`);
console.log("first 12 lines:");
console.log("  " + (ver?.code.split("\n").slice(0, 12).join("\n  ") ?? ""));
console.log(`\nparams: ${p ? `v${p.version} created ${p.createdAt.toISOString()}` : "(none)"}`);
const w = (p?.params as { weights?: unknown[] } | null)?.weights;
console.log(`weights array length: ${Array.isArray(w) ? w.length : "n/a"}`);
process.exit(0);
