import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { uuidv7 } from "./uuidv7.ts";

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const matchKind = pgEnum("match_kind", ["auto", "custom", "sim", "test"]);
export const matchStatus = pgEnum("match_status", ["pending", "running", "done", "failed"]);
export const botLanguage = pgEnum("bot_language", ["js", "ts"]);

// Better Auth uses TEXT ids by default (cuid). We follow that convention for
// users + sessions + accounts so the auth tables interop cleanly.
export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(uuidv7),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name"),
  image: text("image"),
  role: userRole("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Better Auth: per-device session. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey().$defaultFn(uuidv7),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Better Auth: linked OAuth provider account (one row per user × provider). */
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey().$defaultFn(uuidv7),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Better Auth: e.g. magic-link tokens. We don't use them but the table is required. */
export const verifications = pgTable("verifications", {
  id: text("id").primaryKey().$defaultFn(uuidv7),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bots = pgTable(
  "bots",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(false),
    isOfficial: boolean("is_official").notNull().default(false),
    /**
     * If true, the trainer service evolves this bot's params in the background.
     * Toggleable from the admin UI. Opponents in those training matches come
     * from the rest of the live bot pool — their params are read but never written.
     */
    isTrainingTarget: boolean("is_training_target").notNull().default(false),
    clonedFromBotId: uuid("cloned_from_bot_id"),
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner: index("bots_by_owner").on(t.ownerId),
    byOfficial: index("bots_by_official").on(t.isOfficial),
  }),
);

export const botVersions = pgTable(
  "bot_versions",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    language: botLanguage("language").notNull().default("js"),
    isRunnable: boolean("is_runnable").notNull().default(false),
    validationLog: jsonb("validation_log").notNull().default(sql`'[]'::jsonb`),
    sha256: text("sha256").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBot: index("bot_versions_by_bot").on(t.botId, t.uploadedAt),
  }),
);

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  name: text("name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  configId: uuid("config_id"),
  isActive: boolean("is_active").notNull().default(false),
});

export const configs = pgTable("configs", {
  id: uuid("id").primaryKey().$defaultFn(uuidv7),
  name: text("name").notNull(),
  params: jsonb("params").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ratings = pgTable(
  "ratings",
  {
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    rating: doublePrecision("rating").notNull().default(1500),
    rd: doublePrecision("rd").notNull().default(350),
    vol: doublePrecision("vol").notNull().default(0.06),
    games: integer("games").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.botId, t.seasonId] }),
    byRating: index("ratings_by_rating").on(t.seasonId, t.rating),
  }),
);

export const matchQueue = pgTable(
  "match_queue",
  {
    botId: uuid("bot_id")
      .primaryKey()
      .references(() => bots.id, { onDelete: "cascade" }),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    priority: integer("priority").notNull().default(0),
  },
  (t) => ({
    byTime: index("match_queue_by_time").on(t.queuedAt),
  }),
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),
    kind: matchKind("kind").notNull(),
    status: matchStatus("status").notNull().default("pending"),
    configId: uuid("config_id").references(() => configs.id, { onDelete: "set null" }),
    seed: integer("seed").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    winnerBotVersionId: uuid("winner_bot_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index("matches_by_status").on(t.status, t.createdAt),
    bySeason: index("matches_by_season").on(t.seasonId, t.createdAt),
  }),
);

export const matchParticipants = pgTable(
  "match_participants",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    botVersionId: uuid("bot_version_id")
      .notNull()
      .references(() => botVersions.id),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id),
    placement: integer("placement"),
    finalHp: integer("final_hp"),
    damageDealt: integer("damage_dealt").notNull().default(0),
    itemsPicked: integer("items_picked").notNull().default(0),
    ratingDelta: doublePrecision("rating_delta"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchId, t.botId] }),
    byBot: index("match_participants_by_bot").on(t.botId),
  }),
);

export const matchReplays = pgTable("match_replays", {
  matchId: uuid("match_id")
    .primaryKey()
    .references(() => matches.id, { onDelete: "cascade" }),
  ticks: jsonb("ticks").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Bot-controlled per-bot persistent params. Bots write a `state.params` blob
 * at end of match; runner snapshots it as a new versioned row. Old versions
 * are kept (audit / rollback). Reading: take `version DESC LIMIT 1`.
 */
export const botParams = pgTable(
  "bot_params",
  {
    id: uuid("id").primaryKey().$defaultFn(uuidv7),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    params: jsonb("params").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBotVersion: uniqueIndex("bot_params_by_bot_version").on(t.botId, t.version),
    byBotLatest: index("bot_params_by_bot_latest").on(t.botId, t.createdAt),
  }),
);

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    value: doublePrecision("value").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.seasonId, t.metricKey, t.computedAt] }),
    byKey: uniqueIndex("metric_snapshots_latest").on(t.seasonId, t.metricKey, t.computedAt),
  }),
);
