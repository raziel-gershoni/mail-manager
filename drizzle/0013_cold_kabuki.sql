ALTER TABLE "processed_updates" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
-- Every pre-existing row is an update that was already handled: the old claim()
-- inserted a row and left it there on success. Seal them, so the new stale-claim
-- takeover cannot mistake a finished turn for an abandoned one and re-run it.
UPDATE "processed_updates" SET "completed_at" = "created_at" WHERE "completed_at" IS NULL;
