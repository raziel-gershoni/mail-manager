import { describe, it, expect, vi } from "vitest";
import { buildDestination, planPollSchedule, POLL_CRON } from "../../src/queue/qstash.js";

describe("buildDestination", () => {
  it("joins base url and path without double slashes", () => {
    expect(buildDestination("https://app.vercel.app/", "/api/worker")).toBe("https://app.vercel.app/api/worker");
    expect(buildDestination("https://app.vercel.app", "/api/worker")).toBe("https://app.vercel.app/api/worker");
  });
});

describe("POLL_CRON", () => {
  it("runs the inbox poll once an hour, on the hour", () => {
    expect(POLL_CRON).toBe("0 * * * *");
  });
});

describe("planPollSchedule", () => {
  const dest = "https://a/api/poll";
  const cron = "0 * * * *";
  const sched = (scheduleId: string, c: string, destination = dest) => ({ scheduleId, cron: c, destination });

  it("leaves a matching schedule alone", () => {
    expect(planPollSchedule([sched("s1", cron)], dest, cron)).toEqual({ kind: "ok", scheduleId: "s1" });
  });
  it("creates when there are no schedules", () => {
    expect(planPollSchedule([], dest, cron)).toEqual({ kind: "create" });
  });
  it("creates when no schedule matches the destination", () => {
    expect(planPollSchedule([sched("s1", cron, "https://a/api/other")], dest, cron)).toEqual({ kind: "create" });
  });
  it("replaces a schedule whose cron drifted from POLL_CRON", () => {
    // The whole point: editing POLL_CRON must actually reach an existing deployment.
    expect(planPollSchedule([sched("s1", "*/30 * * * *")], dest, cron)).toEqual({ kind: "replace", stale: ["s1"] });
  });
  it("replaces duplicates on one destination even when their cron is right", () => {
    expect(planPollSchedule([sched("s1", cron), sched("s2", cron)], dest, cron))
      .toEqual({ kind: "replace", stale: ["s1", "s2"] });
  });
  it("never touches schedules pointing elsewhere", () => {
    const plan = planPollSchedule([sched("other", "*/5 * * * *", "https://a/api/worker"), sched("s1", "*/30 * * * *")], dest, cron);
    expect(plan).toEqual({ kind: "replace", stale: ["s1"] });
  });
});
