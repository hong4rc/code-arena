CREATE TABLE "bot_params" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bot_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_params" ADD CONSTRAINT "bot_params_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_params_by_bot_version" ON "bot_params" USING btree ("bot_id","version");--> statement-breakpoint
CREATE INDEX "bot_params_by_bot_latest" ON "bot_params" USING btree ("bot_id","created_at");