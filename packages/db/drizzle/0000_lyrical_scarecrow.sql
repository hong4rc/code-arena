CREATE TYPE "public"."bot_language" AS ENUM('js', 'ts');--> statement-breakpoint
CREATE TYPE "public"."match_kind" AS ENUM('auto', 'custom', 'sim', 'test');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "bot_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"code" text NOT NULL,
	"language" "bot_language" DEFAULT 'js' NOT NULL,
	"is_runnable" boolean DEFAULT false NOT NULL,
	"validation_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"cloned_from_bot_id" uuid,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"match_id" uuid NOT NULL,
	"bot_version_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"placement" integer,
	"final_hp" integer,
	"damage_dealt" integer DEFAULT 0 NOT NULL,
	"items_picked" integer DEFAULT 0 NOT NULL,
	"rating_delta" double precision,
	CONSTRAINT "match_participants_match_id_bot_id_pk" PRIMARY KEY("match_id","bot_id")
);
--> statement-breakpoint
CREATE TABLE "match_queue" (
	"bot_id" uuid PRIMARY KEY NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_replays" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"ticks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid,
	"kind" "match_kind" NOT NULL,
	"status" "match_status" DEFAULT 'pending' NOT NULL,
	"config_id" uuid,
	"seed" integer NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"winner_bot_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"season_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" double precision NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_season_id_metric_key_computed_at_pk" PRIMARY KEY("season_id","metric_key","computed_at")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"bot_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"rating" double precision DEFAULT 1500 NOT NULL,
	"rd" double precision DEFAULT 350 NOT NULL,
	"vol" double precision DEFAULT 0.06 NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_bot_id_season_id_pk" PRIMARY KEY("bot_id","season_id")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"config_id" uuid,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_id_unique" UNIQUE("auth_id")
);
--> statement-breakpoint
ALTER TABLE "bot_versions" ADD CONSTRAINT "bot_versions_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bots" ADD CONSTRAINT "bots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_bot_version_id_bot_versions_id_fk" FOREIGN KEY ("bot_version_id") REFERENCES "public"."bot_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_queue" ADD CONSTRAINT "match_queue_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_replays" ADD CONSTRAINT "match_replays_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_config_id_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_versions_by_bot" ON "bot_versions" USING btree ("bot_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "bots_by_owner" ON "bots" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "bots_by_official" ON "bots" USING btree ("is_official");--> statement-breakpoint
CREATE INDEX "match_participants_by_bot" ON "match_participants" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "match_queue_by_time" ON "match_queue" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "matches_by_status" ON "matches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "matches_by_season" ON "matches" USING btree ("season_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_latest" ON "metric_snapshots" USING btree ("season_id","metric_key","computed_at");--> statement-breakpoint
CREATE INDEX "ratings_by_rating" ON "ratings" USING btree ("season_id","rating");