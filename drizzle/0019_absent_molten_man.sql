ALTER TABLE "user_settings" ADD COLUMN "schedule" jsonb DEFAULT '[{"from":0,"to":24},{"from":0,"to":24},{"from":0,"to":24},{"from":0,"to":24},{"from":0,"to":24},{"from":0,"to":24},{"from":0,"to":24}]'::jsonb NOT NULL;--> statement-breakpoint
-- Carry each user's old active days + active hours into the weekly schedule. A day not
-- in active_days is off (null); start = end was "all day"; end = 0 meant "until
-- midnight"; otherwise the same hours, with start > end running past midnight. The old
-- columns stay until 0020, so the deployment still serving during this build keeps working.
UPDATE "user_settings" SET "schedule" = (
  SELECT jsonb_agg(
    CASE
      WHEN NOT (d = ANY ("active_days")) THEN 'null'::jsonb
      WHEN "digest_start_hour" = "digest_end_hour" THEN '{"from":0,"to":24}'::jsonb
      WHEN "digest_end_hour" = 0 THEN jsonb_build_object('from', "digest_start_hour", 'to', 24)
      ELSE jsonb_build_object('from', "digest_start_hour", 'to', "digest_end_hour")
    END ORDER BY d)
  FROM generate_series(0, 6) AS d
);
