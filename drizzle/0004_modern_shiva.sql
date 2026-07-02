CREATE TABLE IF NOT EXISTS "user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"timezone" text,
	"digest_start_hour" integer DEFAULT 0 NOT NULL,
	"digest_end_hour" integer DEFAULT 24 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
