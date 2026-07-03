CREATE TABLE IF NOT EXISTS "processed_updates" (
	"update_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
