CREATE TABLE IF NOT EXISTS "weekly_runs" (
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"week" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_runs_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "weekly_runs" ADD CONSTRAINT "weekly_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
