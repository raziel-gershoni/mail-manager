ALTER TABLE "memories" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_activity" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "poll_activity" ADD COLUMN "source" text;--> statement-breakpoint
-- Every existing rule's first-insert time is unknown (memories had no created_at), and
-- the column default just stamped them all with the migration time — the first weekly
-- retrospect would report every rule as new. updated_at is the best available bound.
UPDATE "memories" SET "created_at" = "updated_at";
