ALTER TABLE "action_log" ADD COLUMN "action" text DEFAULT 'trash' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "action" text;