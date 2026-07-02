# Stage C1: User Settings + Digest Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user settings (timezone, digest-hours window, pause) and make the poll respect them — skipping a user entirely when paused or outside their digest window, and using their own timezone for briefs and agent replies.

**Architecture:** A new `user_settings` table + `dbSettingsRepo`; a pure `settings` module (defaults resolution) and a pure `window` module (timezone-aware, wrap-around window predicate). The Stage B fan-out (`pollAllUsers`) gains a per-user settings gate and passes each user's timezone through. Skip-entirely semantics: a gated user gets zero Gmail/LLM calls and a frozen cursor, so the first in-window poll processes the accumulated batch (the Gmail `historyId` cursor is cumulative). No held-queue.

**Tech Stack:** TypeScript (bundler resolution), Drizzle (Neon), Vitest, Next.js App Router, `Intl.DateTimeFormat` for timezone hours.

## Global Constraints

- Node `>=20`, ESM, explicit `.js` import extensions, bundler resolution; preserve `strict` + `noUncheckedIndexedAccess`.
- **Behavior-preserving for the owner today:** with no `user_settings` row, defaults apply — timezone = `OWNER_TZ` (or `UTC`), digest window **always-on (`0–24`)**, not paused. The owner keeps receiving briefs exactly as before (24/7). Quiet hours are **opt-in**: they take effect only once a user sets a narrower window (via the Stage D mini app), so C1 does not change delivery behavior for anyone.
- Digest window is **skip-entirely**: if paused OR outside the window (evaluated in the user's timezone), the user is skipped with no Gmail/LLM calls and no cursor movement. Window supports overnight wrap (start > end). Hour granularity. `startHour === endHour` means a full-day (always-on) window.
- Per-user timezone flows to both the proactive brief (`generateBrief`) and the conversational agent (`handleMessage`), replacing the global `OWNER_TZ` at those call sites (OWNER_TZ becomes the default fallback).
- Defaults: `digestStartHour = 0`, `digestEndHour = 24` (an always-on window — `isWithinDigestWindow` returns true for every hour when the range is `[0,24)`), `paused = false`.
- Migration `0004` is additive (one new table); it must not alter existing tables.
- All existing tests stay green; `npx next build` (typecheck) is a required gate. Do NOT run `npm run vercel-build` locally. Verify with `npx tsc --noEmit`, `npx vitest run`, `npx next build`.
- Secrets never logged.

---

### Task 1: `user_settings` schema + migration + repo

**Files:**
- Modify: `src/db/schema.ts` (add `userSettings` table)
- Create: migration via `npm run db:generate` (commit `drizzle/0004_*.sql` + `drizzle/meta`)
- Create: `src/db/settings-adapter.ts`
- Create: `tests/db/settings-adapter.contract.test.ts`

**Interfaces:**
- Produces: `SettingsRepo`, `UserSettingsRow` (via Task 2's module — but the repo returns the row shape), `dbSettingsRepo(): SettingsRepo`.

> NOTE: `SettingsRepo`/`UserSettingsRow` are DEFINED in Task 2's `src/settings/settings.ts`. This task depends on Task 2's types. Implement Task 2 FIRST if executing out of order; the plan orders Task 2 before its consumers below by keeping types in Task 2 and importing them here. (Executors: do Task 2 before Task 1's adapter, or define the types first. The controller dispatches Task 2 before Task 1 if needed.)

To avoid the forward dependency, this task is dispatched AFTER Task 2. It imports `SettingsRepo`, `UserSettingsRow` from `../settings/settings.js`.

- [ ] **Step 1: Add the `userSettings` table to `src/db/schema.ts`**

Append after the `telegramLinks` table (uses already-imported `pgTable, integer, text, boolean, timestamp`):
```ts
export const userSettings = pgTable("user_settings", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  timezone: text("timezone"),                                  // null → fall back to OWNER_TZ / UTC
  digestStartHour: integer("digest_start_hour").notNull().default(0),
  digestEndHour: integer("digest_end_hour").notNull().default(24),   // 0–24 = always-on
  paused: boolean("paused").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: creates `drizzle/0004_<name>.sql` with a single `CREATE TABLE "user_settings" (...)` (columns: user_id PK/FK, timezone, digest_start_hour default 0, digest_end_hour default 24, paused default false, updated_at) and the FK to users. Offline diff — no DB connection. INSPECT the SQL and confirm it only CREATEs `user_settings` (no ALTER/DROP of other tables). If anything else appears, STOP and report BLOCKED with the SQL.

- [ ] **Step 3: Implement `src/db/settings-adapter.ts`**

```ts
// src/db/settings-adapter.ts
import { eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { SettingsRepo, UserSettingsRow } from "../settings/settings.js";

export function dbSettingsRepo(): SettingsRepo {
  return {
    async get(userId): Promise<UserSettingsRow | null> {
      const [r] = await db().select().from(schema.userSettings)
        .where(eq(schema.userSettings.userId, userId)).limit(1);
      return r ? { timezone: r.timezone, digestStartHour: r.digestStartHour, digestEndHour: r.digestEndHour, paused: r.paused } : null;
    },
    async upsert(userId, s: UserSettingsRow): Promise<void> {
      await db().insert(schema.userSettings)
        .values({ userId, timezone: s.timezone, digestStartHour: s.digestStartHour, digestEndHour: s.digestEndHour, paused: s.paused, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.userSettings.userId,
          set: { timezone: s.timezone, digestStartHour: s.digestStartHour, digestEndHour: s.digestEndHour, paused: s.paused, updatedAt: new Date() } });
    },
  };
}
```

- [ ] **Step 4: Contract test (gated on `DATABASE_URL`)**

`tests/db/settings-adapter.contract.test.ts`:
```ts
import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("settings-adapter (DB contract)", () => {
  it("upserts and round-trips settings for a user", async () => {
    const { dbSettingsRepo } = await import("../../src/db/settings-adapter.js");
    const repo = dbSettingsRepo();
    await repo.upsert(1, { timezone: "Asia/Jerusalem", digestStartHour: 9, digestEndHour: 21, paused: true });
    await repo.upsert(1, { timezone: "Asia/Jerusalem", digestStartHour: 9, digestEndHour: 21, paused: false }); // update
    expect(await repo.get(1)).toEqual({ timezone: "Asia/Jerusalem", digestStartHour: 9, digestEndHour: 21, paused: false });
  });
});
```
(No-op without `DATABASE_URL`, matching the existing contract-test pattern.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass (contract test skipped). `npx next build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/ src/db/settings-adapter.ts tests/db/settings-adapter.contract.test.ts
git commit -m "feat(db): user_settings table + settings repo"
```

---

### Task 2: Pure settings + window modules

Dispatch this BEFORE Task 1 (Task 1's adapter imports these types). TDD.

**Files:**
- Create: `src/settings/settings.ts`
- Create: `src/settings/window.ts`
- Create: `tests/settings/settings.test.ts`
- Create: `tests/settings/window.test.ts`

**Interfaces:**
- Produces: `UserSettingsRow`, `EffectiveSettings`, `SettingsRepo`, `fakeSettingsRepo`, `effectiveSettings` (settings.ts); `hourInZone`, `isWithinDigestWindow` (window.ts). Consumed by Tasks 1, 3.

- [ ] **Step 1: Write failing tests**

`tests/settings/window.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hourInZone, isWithinDigestWindow } from "../../src/settings/window.js";

describe("hourInZone", () => {
  it("reads the wall-clock hour in a timezone", () => {
    const noonUtc = new Date("2026-07-02T12:00:00Z");
    expect(hourInZone(noonUtc, "UTC")).toBe(12);
    // Asia/Jerusalem is UTC+3 in July (DST) → 15:00
    expect(hourInZone(noonUtc, "Asia/Jerusalem")).toBe(15);
  });
  it("falls back to UTC on an invalid timezone", () => {
    const noonUtc = new Date("2026-07-02T12:00:00Z");
    expect(hourInZone(noonUtc, "Not/AZone")).toBe(12);
  });
  it("normalizes midnight to 0 (never 24)", () => {
    const midnightUtc = new Date("2026-07-02T00:30:00Z");
    expect(hourInZone(midnightUtc, "UTC")).toBe(0);
  });
});

describe("isWithinDigestWindow", () => {
  const at = (h: number) => new Date(`2026-07-02T${String(h).padStart(2, "0")}:00:00Z`);
  it("normal daytime window 8-22", () => {
    expect(isWithinDigestWindow(at(8), "UTC", 8, 22)).toBe(true);
    expect(isWithinDigestWindow(at(21), "UTC", 8, 22)).toBe(true);
    expect(isWithinDigestWindow(at(22), "UTC", 8, 22)).toBe(false); // end exclusive
    expect(isWithinDigestWindow(at(7), "UTC", 8, 22)).toBe(false);
    expect(isWithinDigestWindow(at(3), "UTC", 8, 22)).toBe(false);
  });
  it("overnight wrap window 22-7", () => {
    expect(isWithinDigestWindow(at(23), "UTC", 22, 7)).toBe(true);
    expect(isWithinDigestWindow(at(3), "UTC", 22, 7)).toBe(true);
    expect(isWithinDigestWindow(at(7), "UTC", 22, 7)).toBe(false); // end exclusive
    expect(isWithinDigestWindow(at(12), "UTC", 22, 7)).toBe(false);
  });
  it("start === end means always-on", () => {
    expect(isWithinDigestWindow(at(3), "UTC", 0, 0)).toBe(true);
    expect(isWithinDigestWindow(at(15), "UTC", 9, 9)).toBe(true);
  });
  it("always-on default window 0-24 covers every hour", () => {
    expect(isWithinDigestWindow(at(0), "UTC", 0, 24)).toBe(true);
    expect(isWithinDigestWindow(at(3), "UTC", 0, 24)).toBe(true);
    expect(isWithinDigestWindow(at(23), "UTC", 0, 24)).toBe(true);
  });
});
```

`tests/settings/settings.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { effectiveSettings } from "../../src/settings/settings.js";

describe("effectiveSettings", () => {
  it("applies defaults when the row is null (timezone from ownerTz)", () => {
    expect(effectiveSettings(null, "Asia/Jerusalem")).toEqual({
      timezone: "Asia/Jerusalem", digestStartHour: 0, digestEndHour: 24, paused: false,
    });
  });
  it("defaults timezone to UTC when neither row nor ownerTz has one", () => {
    expect(effectiveSettings(null, undefined)).toEqual({
      timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: false,
    });
  });
  it("uses the row's values when present (row timezone overrides ownerTz)", () => {
    expect(effectiveSettings({ timezone: "Europe/Paris", digestStartHour: 9, digestEndHour: 23, paused: true }, "Asia/Jerusalem")).toEqual({
      timezone: "Europe/Paris", digestStartHour: 9, digestEndHour: 23, paused: true,
    });
  });
  it("falls back to ownerTz when the row's timezone is null", () => {
    expect(effectiveSettings({ timezone: null, digestStartHour: 9, digestEndHour: 23, paused: false }, "Asia/Jerusalem").timezone).toBe("Asia/Jerusalem");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/settings/`
Expected: FAIL — cannot resolve the two modules.

- [ ] **Step 3: Implement `src/settings/settings.ts`**

```ts
// Per-user settings shape + defaults resolution. Pure.
export interface UserSettingsRow {
  timezone: string | null;
  digestStartHour: number;
  digestEndHour: number;
  paused: boolean;
}
export interface EffectiveSettings {
  timezone: string;
  digestStartHour: number;
  digestEndHour: number;
  paused: boolean;
}
export interface SettingsRepo {
  get(userId: number): Promise<UserSettingsRow | null>;
  upsert(userId: number, settings: UserSettingsRow): Promise<void>;
}

export function effectiveSettings(row: UserSettingsRow | null, defaultTz: string | undefined): EffectiveSettings {
  return {
    timezone: row?.timezone ?? defaultTz ?? "UTC",
    digestStartHour: row?.digestStartHour ?? 0,
    digestEndHour: row?.digestEndHour ?? 24,
    paused: row?.paused ?? false,
  };
}

export function fakeSettingsRepo(seed: Record<number, UserSettingsRow> = {}): SettingsRepo {
  const rows: Record<number, UserSettingsRow> = { ...seed };
  return {
    async get(userId) { return rows[userId] ?? null; },
    async upsert(userId, settings) { rows[userId] = settings; },
  };
}
```

- [ ] **Step 4: Implement `src/settings/window.ts`**

```ts
// Timezone-aware digest-window predicate. Pure.
export function hourInZone(now: Date, timezone: string): number {
  const zone = timezone || "UTC";
  const read = (tz: string): number => {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now);
    const h = parseInt(s, 10);
    return h === 24 ? 0 : h; // some ICU builds render midnight as "24"
  };
  try { return read(zone); } catch { return read("UTC"); }
}

// True if `now` (in `timezone`) is within [startHour, endHour). Supports overnight
// wrap (start > end). startHour === endHour means a full-day (always-on) window.
export function isWithinDigestWindow(now: Date, timezone: string, startHour: number, endHour: number): boolean {
  const hour = hourInZone(now, timezone);
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/settings/`
Expected: PASS. Note: the `Asia/Jerusalem` DST assertion (UTC+3 in July) relies on the runtime's IANA tz database (present on Node ≥20). Then `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/settings/ tests/settings/
git commit -m "feat(settings): effective-settings defaults + timezone digest-window predicate"
```

---

### Task 3: Wire settings into the poll fan-out and the agent

**Files:**
- Modify: `src/notifier/fanout.ts` (settings gate + timezone passthrough)
- Modify: `tests/notifier/fanout.test.ts` (new signature + gate cases)
- Modify: `app/api/poll/route.ts` (provide `now`, `settingsFor`, timezone-aware `pollUser`)
- Modify: `app/api/worker/route.ts` (per-user timezone for `handleMessage`)

**Interfaces:**
- Consumes: `EffectiveSettings`, `effectiveSettings` (Task 2), `isWithinDigestWindow` (Task 2), `dbSettingsRepo` (Task 1).
- Produces: `pollAllUsers` with the new `FanoutDeps` + `{polled, skipped, gated, errored}` return.

- [ ] **Step 1: Update `tests/notifier/fanout.test.ts` (write the new expectations first)**

Replace the file with:
```ts
import { describe, it, expect } from "vitest";
import { pollAllUsers } from "../../src/notifier/fanout.js";
import { fakeTelegramLinkRepo, fakeUserDirectory } from "../../src/users/identity.js";
import type { EffectiveSettings } from "../../src/settings/settings.js";

const OWNER = 555;
const IN_WINDOW = new Date("2026-07-02T12:00:00Z"); // noon UTC
const on = (over: Partial<EffectiveSettings> = {}): EffectiveSettings =>
  ({ timezone: "UTC", digestStartHour: 8, digestEndHour: 22, paused: false, ...over });

describe("pollAllUsers", () => {
  it("bootstraps the owner link, then polls each in-window user at their chat + timezone", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([1]);
    const calls: Array<{ userId: number; chatId: number; tz: string }> = [];
    const res = await pollAllUsers({
      ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ timezone: "Asia/Jerusalem" }),
      pollUser: async (userId, chatId, timezone) => { calls.push({ userId, chatId, tz: timezone }); },
    });
    expect(calls).toEqual([{ userId: 1, chatId: OWNER, tz: "Asia/Jerusalem" }]);
    expect(res).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 0 });
  });
  it("skips a user with no telegram link (skipped), not gated", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1, 2]);
    const calls: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on(), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([1]);
    expect(res).toEqual({ polled: 1, skipped: 1, gated: 0, errored: 0 });
  });
  it("gates a paused user (gated, no pollUser call)", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1]);
    const calls: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ paused: true }), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([]);
    expect(res).toEqual({ polled: 0, skipped: 0, gated: 1, errored: 0 });
  });
  it("gates a user outside their digest window", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1]);
    const calls: number[] = [];
    // window 8-9 UTC; now is noon UTC → outside
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on({ digestStartHour: 8, digestEndHour: 9 }), pollUser: async (u) => { calls.push(u); } });
    expect(calls).toEqual([]);
    expect(res).toEqual({ polled: 0, skipped: 0, gated: 1, errored: 0 });
  });
  it("isolates a per-user failure and continues (errored)", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const dir = fakeUserDirectory([1, 2]);
    const ok: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir, now: IN_WINDOW,
      settingsFor: async () => on(), pollUser: async (u) => { if (u === 1) throw new Error("boom"); ok.push(u); } });
    expect(ok).toEqual([2]);
    expect(res).toEqual({ polled: 1, skipped: 0, gated: 0, errored: 1 });
  });
});
```

- [ ] **Step 2: Run to verify the updated tests fail against the old fan-out**

Run: `npx vitest run tests/notifier/fanout.test.ts`
Expected: FAIL (old `pollAllUsers` has no `now`/`settingsFor`, no `gated` in the result, and `pollUser` gets no timezone).

- [ ] **Step 3: Rewrite `src/notifier/fanout.ts`**

```ts
// Fan the poll out over every user with a linked Google account, respecting per-user settings.
import type { TelegramLinkRepo, UserDirectory } from "../users/identity.js";
import { ensureOwnerLink } from "../users/identity.js";
import type { EffectiveSettings } from "../settings/settings.js";
import { isWithinDigestWindow } from "../settings/window.js";

export interface FanoutDeps {
  ownerTelegramId: number;
  links: TelegramLinkRepo;
  directory: UserDirectory;
  now: Date;
  settingsFor: (userId: number) => Promise<EffectiveSettings>;
  pollUser: (userId: number, chatId: number, timezone: string) => Promise<void>;
}

export async function pollAllUsers(deps: FanoutDeps): Promise<{ polled: number; skipped: number; gated: number; errored: number }> {
  await ensureOwnerLink(deps.ownerTelegramId, deps.links, deps.directory);
  const userIds = await deps.directory.usersWithGoogleAccount();
  let polled = 0, skipped = 0, gated = 0, errored = 0;
  for (const userId of userIds) {
    const link = await deps.links.getByUserId(userId);
    if (!link) { skipped++; continue; }                                // no chat to deliver to
    const s = await deps.settingsFor(userId);
    if (s.paused || !isWithinDigestWindow(deps.now, s.timezone, s.digestStartHour, s.digestEndHour)) { gated++; continue; }
    try { await deps.pollUser(userId, link.chatId, s.timezone); polled++; }
    catch (e) { errored++; console.error(`poll failed for user ${userId}`, e); }
  }
  return { polled, skipped, gated, errored };
}
```

- [ ] **Step 4: Run to verify the fan-out tests pass**

Run: `npx vitest run tests/notifier/fanout.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Rewire `app/api/poll/route.ts`**

Replace the file's body with (adds settings imports; `now`, `settingsFor`, and a timezone param on `pollUser`):
```ts
// app/api/poll/route.ts
import { env } from "../../../src/config/env.js";
import { verifyQStash } from "../../../src/queue/qstash.js";
import { authedGmailFor } from "../../../src/oauth/google.js";
import { googleGmailClient } from "../../../src/gmail/client.js";
import { geminiProvider } from "../../../src/llm/gemini.js";
import { dbMemoryStore, dbSeenRepo, dbSyncRepo } from "../../../src/db/adapters.js";
import { dbConversationRepo } from "../../../src/db/conversation-adapter.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
import { runPoll } from "../../../src/notifier/poll.js";
import { generateBrief } from "../../../src/notifier/brief.js";
import { pollAllUsers } from "../../../src/notifier/fanout.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  await verifyQStash(e, req);
  const llm = geminiProvider(e.GEMINI_API_KEY);
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  const settingsRepo = dbSettingsRepo();
  const summary = await pollAllUsers({
    ownerTelegramId: e.TELEGRAM_OWNER_ID,
    links: dbTelegramLinkRepo(),
    directory: dbUserDirectory(),
    now: new Date(),
    settingsFor: async (userId) => effectiveSettings(await settingsRepo.get(userId), e.OWNER_TZ),
    pollUser: async (userId, chatId, timezone) => {
      const auth = await authedGmailFor(userId, e);
      const gmail = googleGmailClient(auth);
      const res = await runPoll({ userId, gmail, store: await dbMemoryStore(userId), llm, sync: dbSyncRepo(), seen: dbSeenRepo() });
      if (res.firstRun) return;
      const ids = res.important.map(i => i.messageId);
      if (ids.length === 0) { await res.commit(); return; }
      let brief = await generateBrief(ids, { gmail, llm, timezone });
      if (!brief || brief.trim() === "") {
        brief = `${ids.length} new important email(s):\n` +
          res.important.map(i => `• ${i.subject || "(no subject)"} — ${i.from}`).join("\n");
      }
      await sendFormatted(bot, chatId, brief);
      await dbConversationRepo().appendTurn(userId, { role: "brief", content: brief });
      await res.commit();
    },
  });
  return Response.json({ ok: true, ...summary });
}
```

- [ ] **Step 6: Rewire `app/api/worker/route.ts`** (per-user timezone for the agent)

In `app/api/worker/route.ts`, add the two imports and replace the `timezone: e.OWNER_TZ` in the `handleMessage` deps with the user's effective timezone.

Add imports (next to the other `src/db` imports):
```ts
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
```
After `const store = await dbMemoryStore(userId);`, add:
```ts
  const settings = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
```
Then in the `handleMessage(text, { ... })` deps object, change:
```ts
    tools: [...readOnlyTools(), ...trashTools()], timezone: e.OWNER_TZ,
```
to:
```ts
    tools: [...readOnlyTools(), ...trashTools()], timezone: settings.timezone,
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass (fan-out + settings + existing). `npx next build` → succeeds; `/api/poll` + `/api/worker` still dynamic.

- [ ] **Step 8: Commit**

```bash
git add src/notifier/fanout.ts tests/notifier/fanout.test.ts app/api/poll/route.ts app/api/worker/route.ts
git commit -m "feat(poll): per-user digest window + timezone (skip-entirely when paused/off-hours)"
```

---

## Self-Review

**Spec coverage (Stage C, settings/digest-window slice of spec §6):**
- `user_settings` table (userId PK, timezone, digest_start/end_hour, paused) → Task 1. ✓
- Defaults + owner backfill via read-time defaults (no migration backfill needed) → `effectiveSettings` (Task 2). ✓
- Skip-entirely: paused OR outside window → `pollAllUsers` gate (Task 3), zero Gmail/LLM calls, cursor frozen (skip happens before `pollUser`/`runPoll`). ✓
- Window in user's tz, overnight wrap, hour granularity → `isWithinDigestWindow` (Task 2). ✓
- Per-user timezone into brief + agent → Task 3 (poll `pollUser` timezone, worker `handleMessage` timezone). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content; the generated migration's expected content is named in Task 1 Step 2. ✓

**Type consistency:** `UserSettingsRow`/`EffectiveSettings`/`SettingsRepo` are defined once (Task 2) and imported by Task 1 (adapter) and Task 3 (route/worker). `effectiveSettings(row, defaultTz)` and `isWithinDigestWindow(now, tz, start, end)` signatures match across definition, tests, and call sites. `FanoutDeps` (Task 3) matches its test and the poll route's call. ✓

**Dispatch order note:** Task 2 (pure types/modules) is dispatched BEFORE Task 1 (adapter imports its types) and Task 3.

## Execution Handoff

After all tasks pass, run a whole-branch adversarial review (owner behavior-preservation is the key risk — confirm the always-on default window `0–24` truly returns true for every hour so the owner's 24/7 briefs are unchanged, and that a gated user's cursor does not advance), then merge to `main` via `superpowers:finishing-a-development-branch`. Stage C2 (token-refresh hardening) branches off the merged `main`.

**Merge-gate note for the user:** C1 defaults every user to an always-on window (no behavior change — the owner keeps 24/7 briefs). Quiet hours become settable in the Stage D mini app. If the owner would rather default to a daytime window (e.g. `08–22`) immediately, that's a one-line default change — surface it at the merge gate.
