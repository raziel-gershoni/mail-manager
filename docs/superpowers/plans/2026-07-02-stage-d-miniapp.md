# Stage D: Telegram Mini App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Telegram Mini App at `/miniapp` where the user sets their timezone, digest-hours window, and pause state, sees their Gmail connection status with a reconnect button, and views their learned rules — all authenticated by Telegram `initData` (HMAC), resolved to a user via `telegram_links`.

**Architecture:** A pure, unit-tested `initData` verifier (HMAC-SHA256 per Telegram's spec) + a read-only identity resolver + a pure settings-view/patch layer over the existing repos. Three initData-gated API routes (`GET`/`POST /api/settings`, `POST /api/settings/reconnect`) and one client React page. A bot menu button opens the app. Reuses C1 (`dbSettingsRepo`, `effectiveSettings`), C2 (`dbOAuthStateRepo`, `buildAuthUrl`, `dbGoogleAccountRepo`), and B (`dbTelegramLinkRepo`, `dbUserDirectory`).

**Tech Stack:** Next.js 15 App Router (client + route handlers), React 19, `node:crypto` (HMAC/timing-safe compare), Drizzle, Vitest.

## Global Constraints

- Node `>=20`, ESM, explicit `.js` import extensions (server); bundler resolution; preserve `strict` + `noUncheckedIndexedAccess`.
- **initData verification is the security boundary.** Follow Telegram's documented algorithm EXACTLY: `secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)`; `hash = hex(HMAC_SHA256(key=secret_key, message=data_check_string))`; `data_check_string` = every field except `hash`, formatted `key=value`, sorted by key, joined with `\n`, using the URL-DECODED values. Compare with a timing-safe equal. Reject if the hash mismatches, `auth_date` is older than 15 minutes, or `user`/`hash` is missing.
- Every settings API route: verify initData → resolve `userId` (read-only) → 401 on any failure. No route trusts a client-supplied user id.
- Settings validation: `digestStartHour ∈ [0,23]`, `digestEndHour ∈ [0,24]`, `paused` boolean, `timezone` a valid IANA zone (`Intl.DateTimeFormat` accepts it). Reject invalid with 400.
- Learned rules are **read-only** in the UI (view, no edit/delete).
- Reuse existing modules; do not duplicate settings/OAuth logic. OAuth scope stays `gmail.modify`; secrets never logged (never log `initData` or the bot token).
- Minimal styling using Telegram theme CSS variables; no component library.
- All existing tests stay green; `npx next build` (typecheck) is a required gate. Verify with `npx tsc --noEmit`, `npx vitest run`, `npx next build`. Do NOT run `npm run vercel-build`.

---

### Task 1: `initData` verification (the auth boundary)

**Files:**
- Create: `src/telegram/initdata.ts`
- Create: `tests/telegram/initdata.test.ts`

**Interfaces:**
- Produces: `verifyInitData(initData: string, botToken: string, now: Date, maxAgeMs?: number): { telegramUserId: number } | null`.

- [ ] **Step 1: Write failing tests** `tests/telegram/initdata.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyInitData } from "../../src/telegram/initdata.js";

const TOKEN = "123456:test-bot-token";
const NOW = new Date("2026-07-02T12:00:00Z");

// Build a valid initData string the same way Telegram does (independent of the impl's code).
function makeInitData(fields: Record<string, string>, token: string): string {
  const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const authDate = String(Math.floor(NOW.getTime() / 1000));
const userField = JSON.stringify({ id: 555, first_name: "O" });

describe("verifyInitData", () => {
  it("accepts a valid signature and extracts the telegram user id", () => {
    const initData = makeInitData({ auth_date: authDate, user: userField, query_id: "q1" }, TOKEN);
    expect(verifyInitData(initData, TOKEN, NOW)).toEqual({ telegramUserId: 555 });
  });
  it("rejects a tampered field (hash no longer matches)", () => {
    const initData = makeInitData({ auth_date: authDate, user: userField }, TOKEN);
    const tampered = initData.replace("555", "999"); // changes user, not hash
    expect(verifyInitData(tampered, TOKEN, NOW)).toBeNull();
  });
  it("rejects a signature made with a different bot token", () => {
    const initData = makeInitData({ auth_date: authDate, user: userField }, "999999:other-token");
    expect(verifyInitData(initData, TOKEN, NOW)).toBeNull();
  });
  it("rejects stale initData (auth_date older than 15 min)", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 16 * 60);
    const initData = makeInitData({ auth_date: old, user: userField }, TOKEN);
    expect(verifyInitData(initData, TOKEN, NOW)).toBeNull();
  });
  it("rejects missing hash / missing user / empty input", () => {
    expect(verifyInitData("", TOKEN, NOW)).toBeNull();
    expect(verifyInitData(new URLSearchParams({ auth_date: authDate, user: userField }).toString(), TOKEN, NOW)).toBeNull(); // no hash
    const noUser = makeInitData({ auth_date: authDate }, TOKEN);
    expect(verifyInitData(noUser, TOKEN, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/telegram/initdata.test.ts`
Expected: FAIL — cannot resolve `../../src/telegram/initdata.js`.

- [ ] **Step 3: Implement `src/telegram/initdata.ts`**

```ts
// Telegram Mini App initData verification (HMAC-SHA256, per Telegram's WebApp spec).
// This is the auth boundary: a valid result means the request genuinely came from
// this bot's Mini App for the returned Telegram user.
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

export function verifyInitData(
  initData: string, botToken: string, now: Date, maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): { telegramUserId: number } | null {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  // data_check_string: every field except `hash`, "key=value", sorted by key, joined by "\n"
  // (URLSearchParams yields URL-decoded values, which is what Telegram signs).
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  let ok = false;
  try {
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(hash, "hex");
    ok = a.length === b.length && timingSafeEqual(a, b);
  } catch { return null; }
  if (!ok) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return null;
  if (now.getTime() - authDate * 1000 >= maxAgeMs) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  let telegramUserId: number;
  try { telegramUserId = Number((JSON.parse(userJson) as { id: unknown }).id); } catch { return null; }
  if (!Number.isFinite(telegramUserId)) return null;

  return { telegramUserId };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/telegram/initdata.test.ts`
Expected: PASS (all cases). Then `npx vitest run` (full suite) + `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/initdata.ts tests/telegram/initdata.test.ts
git commit -m "feat(telegram): initData HMAC verification (mini-app auth boundary)"
```

---

### Task 2: Read-only resolver + settings-view/patch layer + account status

**Files:**
- Modify: `src/users/identity.ts` (add `resolveUserIdForApp`)
- Create: `src/settings/service.ts` (`buildSettingsView`, `validateSettingsPatch`, `mergePatch`)
- Modify: `src/oauth/reconnect.ts` (add `getStatus` to `GoogleAccountRepo` + fake) and `src/db/google-account-adapter.ts` (impl)
- Create: `tests/settings/service.test.ts`
- Modify: `tests/users/identity.test.ts` (add `resolveUserIdForApp` cases)

**Interfaces:**
- Produces: `resolveUserIdForApp(ownerTelegramId, telegramUserId, links, directory): Promise<number|null>`; `SettingsView`, `SettingsPatch`, `buildSettingsView(eff, account, rules)`, `validateSettingsPatch(body)`, `mergePatch(eff, patch)`; `GoogleAccountRepo.getStatus(userId): Promise<{email,needsReconnect}|null>`.

- [ ] **Step 1: Add `resolveUserIdForApp` to `src/users/identity.ts`** (read-only — no upsert)

```ts
// Read-only identity resolution for the mini app (no lazy link creation).
export async function resolveUserIdForApp(
  ownerTelegramId: number, telegramUserId: number,
  links: TelegramLinkRepo, directory: UserDirectory,
): Promise<number | null> {
  const link = await links.getByTelegramUserId(telegramUserId);
  if (link) return link.userId;
  if (telegramUserId === ownerTelegramId) return directory.ownerUserId();
  return null;
}
```
Add to `tests/users/identity.test.ts` a describe block:
```ts
describe("resolveUserIdForApp", () => {
  it("returns the linked userId, else owner→ownerUserId, else null (no upsert)", async () => {
    const linked = fakeTelegramLinkRepo([{ userId: 7, telegramUserId: 999, chatId: 999 }]);
    const dir = fakeUserDirectory([3, 7]);
    expect(await resolveUserIdForApp(555, 999, linked, dir)).toBe(7);
    const empty = fakeTelegramLinkRepo([]);
    expect(await resolveUserIdForApp(555, 555, empty, dir)).toBe(3);   // owner → min userId
    expect(empty.all()).toEqual([]);                                   // no upsert side effect
    expect(await resolveUserIdForApp(555, 123, empty, dir)).toBeNull(); // unlinked non-owner
  });
});
```
(Add `resolveUserIdForApp` to the import at the top of the test file.)

- [ ] **Step 2: Add `getStatus` to `GoogleAccountRepo`** in `src/oauth/reconnect.ts`

Add to the `GoogleAccountRepo` interface:
```ts
  getStatus(userId: number): Promise<{ email: string; needsReconnect: boolean } | null>;
```
Add to `fakeGoogleAccountRepo` (accept an optional status seed; default derives from the needs map):
```ts
export function fakeGoogleAccountRepo(seed: Record<number, boolean> = {}, emails: Record<number, string> = {}): GoogleAccountRepo & { flag(userId: number): boolean } {
  const needs: Record<number, boolean> = { ...seed };
  return {
    async markNeedsReconnect(userId) { if (needs[userId]) return false; needs[userId] = true; return true; },
    async clearNeedsReconnect(userId) { needs[userId] = false; },
    async updateRefreshToken() { /* no-op in fake */ },
    async getStatus(userId) { return userId in needs ? { email: emails[userId] ?? "a@b.com", needsReconnect: needs[userId]! } : null; },
    flag(userId) { return needs[userId] ?? false; },
  };
}
```

- [ ] **Step 3: Implement `getStatus` in `src/db/google-account-adapter.ts`**

Add to the returned object:
```ts
    async getStatus(userId) {
      const [r] = await db().select({ email: schema.googleAccounts.email, needsReconnect: schema.googleAccounts.needsReconnect })
        .from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
      return r ? { email: r.email, needsReconnect: r.needsReconnect } : null;
    },
```

- [ ] **Step 4: Write failing tests** `tests/settings/service.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildSettingsView, validateSettingsPatch, mergePatch } from "../../src/settings/service.js";
import type { EffectiveSettings } from "../../src/settings/settings.js";

const eff: EffectiveSettings = { timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: false };

describe("validateSettingsPatch", () => {
  it("accepts a valid partial patch", () => {
    expect(validateSettingsPatch({ digestStartHour: 8, digestEndHour: 22, paused: true, timezone: "Asia/Jerusalem" }))
      .toEqual({ digestStartHour: 8, digestEndHour: 22, paused: true, timezone: "Asia/Jerusalem" });
  });
  it("rejects out-of-range hours, bad tz, non-boolean paused, non-object", () => {
    expect(validateSettingsPatch({ digestStartHour: 24 })).toHaveProperty("error"); // start max 23
    expect(validateSettingsPatch({ digestEndHour: 25 })).toHaveProperty("error");
    expect(validateSettingsPatch({ timezone: "Not/AZone" })).toHaveProperty("error");
    expect(validateSettingsPatch({ paused: "yes" })).toHaveProperty("error");
    expect(validateSettingsPatch(null)).toHaveProperty("error");
  });
  it("allows digestEndHour 24 (always-on end)", () => {
    expect(validateSettingsPatch({ digestEndHour: 24 })).toEqual({ digestEndHour: 24 });
  });
});

describe("mergePatch", () => {
  it("overlays only provided fields onto the effective settings", () => {
    expect(mergePatch(eff, { paused: true })).toEqual({ timezone: "UTC", digestStartHour: 0, digestEndHour: 24, paused: true });
  });
});

describe("buildSettingsView", () => {
  it("assembles settings + gmail status + read-only rules", () => {
    const rules = [
      { userId: 1, slug: "sender:x@y.com", description: "", body: "", scope: "sender", matchType: "sender", matchValue: "x@y.com", verdict: "important" },
      { userId: 1, slug: "note", description: "n", body: "", scope: "global", matchType: null, matchValue: null, verdict: null },
    ];
    const view = buildSettingsView(eff, { email: "me@gmail.com", needsReconnect: true }, rules);
    expect(view.gmail).toEqual({ email: "me@gmail.com", connected: true, needsReconnect: true });
    expect(view.rules).toEqual([{ matchValue: "x@y.com", scope: "sender", verdict: "important" }]); // only match rules
    expect(view.paused).toBe(false);
  });
  it("reports disconnected when there is no account", () => {
    expect(buildSettingsView(eff, null, []).gmail).toEqual({ email: null, connected: false, needsReconnect: false });
  });
});
```

- [ ] **Step 5: Run to verify they fail**, then implement `src/settings/service.ts`:

```ts
import type { EffectiveSettings, UserSettingsRow } from "./settings.js";
import type { MemoryRow } from "../memory/store.js";

export interface SettingsView extends EffectiveSettings {
  gmail: { email: string | null; connected: boolean; needsReconnect: boolean };
  rules: Array<{ matchValue: string; scope: string; verdict: string }>;
}
export interface SettingsPatch { timezone?: string; digestStartHour?: number; digestEndHour?: number; paused?: boolean; }

function isHour(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
}
function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
}

export function validateSettingsPatch(body: unknown): SettingsPatch | { error: string } {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  const p = body as Record<string, unknown>;
  const out: SettingsPatch = {};
  if (p.timezone !== undefined) { if (typeof p.timezone !== "string" || !isValidTimezone(p.timezone)) return { error: "invalid timezone" }; out.timezone = p.timezone; }
  if (p.digestStartHour !== undefined) { if (!isHour(p.digestStartHour, 23)) return { error: "invalid digestStartHour" }; out.digestStartHour = p.digestStartHour; }
  if (p.digestEndHour !== undefined) { if (!isHour(p.digestEndHour, 24)) return { error: "invalid digestEndHour" }; out.digestEndHour = p.digestEndHour; }
  if (p.paused !== undefined) { if (typeof p.paused !== "boolean") return { error: "invalid paused" }; out.paused = p.paused; }
  return out;
}

export function mergePatch(eff: EffectiveSettings, patch: SettingsPatch): UserSettingsRow {
  return {
    timezone: patch.timezone ?? eff.timezone,
    digestStartHour: patch.digestStartHour ?? eff.digestStartHour,
    digestEndHour: patch.digestEndHour ?? eff.digestEndHour,
    paused: patch.paused ?? eff.paused,
  };
}

export function buildSettingsView(
  eff: EffectiveSettings,
  account: { email: string; needsReconnect: boolean } | null,
  rules: MemoryRow[],
): SettingsView {
  return {
    ...eff,
    gmail: { email: account?.email ?? null, connected: account !== null, needsReconnect: account?.needsReconnect ?? false },
    rules: rules.filter(r => r.matchType !== null && r.matchValue !== null)
      .map(r => ({ matchValue: r.matchValue as string, scope: r.scope, verdict: r.verdict ?? "" })),
  };
}
```
Run `npx vitest run tests/settings/service.test.ts tests/users/identity.test.ts` → PASS; then `npx vitest run` + `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/users/identity.ts src/settings/service.ts src/oauth/reconnect.ts src/db/google-account-adapter.ts tests/settings/service.test.ts tests/users/identity.test.ts
git commit -m "feat(settings): app resolver + settings-view/patch + gmail status"
```

---

### Task 3: `GET`/`POST /api/settings`

**Files:**
- Create: `app/api/settings/route.ts`

**Interfaces:**
- Consumes: `verifyInitData` (T1), `resolveUserIdForApp` (T2), `dbTelegramLinkRepo`/`dbUserDirectory` (B), `dbSettingsRepo`/`effectiveSettings` (C1), `dbGoogleAccountRepo` (C2), `dbMemoryStore` (existing), `buildSettingsView`/`validateSettingsPatch`/`mergePatch` (T2).

- [ ] **Step 1: Implement `app/api/settings/route.ts`**

```ts
// app/api/settings/route.ts
import { env } from "../../../src/config/env.js";
import { verifyInitData } from "../../../src/telegram/initdata.js";
import { resolveUserIdForApp } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { dbSettingsRepo } from "../../../src/db/settings-adapter.js";
import { dbGoogleAccountRepo } from "../../../src/db/google-account-adapter.js";
import { dbMemoryStore } from "../../../src/db/adapters.js";
import { effectiveSettings } from "../../../src/settings/settings.js";
import { buildSettingsView, validateSettingsPatch, mergePatch } from "../../../src/settings/service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authUser(req: Request): Promise<number | null> {
  const e = env();
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v) return null;
  return resolveUserIdForApp(e.TELEGRAM_OWNER_ID, v.telegramUserId, dbTelegramLinkRepo(), dbUserDirectory());
}

export async function GET(req: Request): Promise<Response> {
  const e = env();
  const userId = await authUser(req);
  if (userId === null) return new Response("unauthorized", { status: 401 });
  const eff = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
  const account = await dbGoogleAccountRepo().getStatus(userId);
  const rules = (await dbMemoryStore(userId)).list();
  return Response.json(buildSettingsView(eff, account, rules));
}

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const userId = await authUser(req);
  if (userId === null) return new Response("unauthorized", { status: 401 });
  const patch = validateSettingsPatch(await req.json().catch(() => null));
  if ("error" in patch) return Response.json({ error: patch.error }, { status: 400 });
  const eff = effectiveSettings(await dbSettingsRepo().get(userId), e.OWNER_TZ);
  await dbSettingsRepo().upsert(userId, mergePatch(eff, patch));
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Verify + commit**

`npx tsc --noEmit` clean; `npx vitest run` green; `npx next build` → `/api/settings` emitted (dynamic).
```bash
git add app/api/settings/route.ts
git commit -m "feat(api): initData-gated GET/POST /api/settings"
```

---

### Task 4: `POST /api/settings/reconnect`

**Files:**
- Create: `app/api/settings/reconnect/route.ts`

- [ ] **Step 1: Implement `app/api/settings/reconnect/route.ts`**

```ts
// app/api/settings/reconnect/route.ts — mints a user-bound Google OAuth URL for the mini app.
import { randomBytes } from "node:crypto";
import { env } from "../../../../src/config/env.js";
import { verifyInitData } from "../../../../src/telegram/initdata.js";
import { resolveUserIdForApp } from "../../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../../src/db/user-adapters.js";
import { dbOAuthStateRepo } from "../../../../src/db/oauth-state-adapter.js";
import { buildAuthUrl } from "../../../../src/oauth/google.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const v = verifyInitData(req.headers.get("x-telegram-init-data") ?? "", e.TELEGRAM_BOT_TOKEN, new Date());
  if (!v) return new Response("unauthorized", { status: 401 });
  const userId = await resolveUserIdForApp(e.TELEGRAM_OWNER_ID, v.telegramUserId, dbTelegramLinkRepo(), dbUserDirectory());
  if (userId === null) return new Response("unauthorized", { status: 401 });
  const state = randomBytes(16).toString("hex");
  await dbOAuthStateRepo().create(state, userId);
  return Response.json({ url: buildAuthUrl(e, state) });
}
```
(This reuses C2's `oauth_states` + user-aware callback: the user consents, the callback consumes the state and binds the token to `userId`.)

- [ ] **Step 2: Verify + commit**

`npx tsc --noEmit` clean; `npx vitest run` green; `npx next build` → `/api/settings/reconnect` emitted.
```bash
git add app/api/settings/reconnect/route.ts
git commit -m "feat(api): initData-gated reconnect endpoint (user-bound OAuth url)"
```

---

### Task 5: The Mini App page

**Files:**
- Create: `app/miniapp/layout.tsx` (loads the Telegram WebApp script)
- Create: `app/miniapp/page.tsx` (client component)

- [ ] **Step 1: Create `app/miniapp/layout.tsx`**

```tsx
import Script from "next/script";
import type { ReactNode } from "react";

export const metadata = { title: "Mail Manager — Settings" };

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {children}
    </>
  );
}
```

- [ ] **Step 2: Create `app/miniapp/page.tsx`** (client; reads initData, renders the form)

```tsx
"use client";
import { useEffect, useState } from "react";

type View = {
  timezone: string; digestStartHour: number; digestEndHour: number; paused: boolean;
  gmail: { email: string | null; connected: boolean; needsReconnect: boolean };
  rules: Array<{ matchValue: string; scope: string; verdict: string }>;
};

function initData(): string {
  if (typeof window === "undefined") return "";
  return (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? "";
}

const HOURS = Array.from({ length: 25 }, (_, i) => i); // 0..24

export default function MiniApp() {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<string>("Loading…");
  const headers = { "x-telegram-init-data": initData(), "content-type": "application/json" };

  useEffect(() => {
    fetch("/api/settings", { headers })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((v: View) => { setView(v); setStatus(""); })
      .catch(() => setStatus("Couldn’t load settings. Open this from the bot’s menu button."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<View>) {
    setStatus("Saving…");
    const r = await fetch("/api/settings", { method: "POST", headers, body: JSON.stringify(patch) });
    setStatus(r.ok ? "Saved ✓" : "Save failed");
  }
  async function reconnect() {
    const r = await fetch("/api/settings/reconnect", { method: "POST", headers });
    if (!r.ok) { setStatus("Reconnect failed"); return; }
    const { url } = await r.json();
    const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } }).Telegram?.WebApp;
    if (tg?.openLink) tg.openLink(url); else window.open(url, "_blank");
  }

  if (!view) return <main style={S.main}><p>{status}</p></main>;

  return (
    <main style={S.main}>
      <h2 style={S.h}>Settings</h2>

      <label style={S.row}>Timezone
        <input style={S.input} defaultValue={view.timezone}
          onBlur={e => save({ timezone: e.target.value })} />
      </label>

      <div style={S.row}>Digest window
        <span>
          <select defaultValue={view.digestStartHour} onChange={e => save({ digestStartHour: Number(e.target.value) } as Partial<View>)}>
            {HOURS.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
          {" – "}
          <select defaultValue={view.digestEndHour} onChange={e => save({ digestEndHour: Number(e.target.value) } as Partial<View>)}>
            {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </span>
      </div>

      <label style={S.row}>Pause briefs
        <input type="checkbox" defaultChecked={view.paused} onChange={e => save({ paused: e.target.checked })} />
      </label>

      <div style={S.row}>Gmail
        <span>
          {view.gmail.connected ? (view.gmail.needsReconnect ? "⚠️ needs reconnect" : `✅ ${view.gmail.email}`) : "not connected"}
          {" "}<button style={S.btn} onClick={reconnect}>Reconnect</button>
        </span>
      </div>

      <h3 style={S.h}>Learned rules</h3>
      {view.rules.length === 0 ? <p style={S.dim}>None yet.</p> : (
        <ul style={S.list}>
          {view.rules.map((r, i) => <li key={i}>{r.matchValue} → {r.verdict}</li>)}
        </ul>
      )}

      <p style={S.dim}>{status}</p>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", padding: 16, color: "var(--tg-theme-text-color, #000)", background: "var(--tg-theme-bg-color, #fff)", maxWidth: 480 },
  h: { margin: "12px 0 8px" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--tg-theme-hint-color, #eee)" },
  input: { flex: 1, maxWidth: 200 },
  btn: { padding: "4px 10px", background: "var(--tg-theme-button-color, #2ea6ff)", color: "var(--tg-theme-button-text-color, #fff)", border: "none", borderRadius: 6, cursor: "pointer" },
  list: { paddingLeft: 18 },
  dim: { color: "var(--tg-theme-hint-color, #888)", fontSize: 13 },
};
```

- [ ] **Step 3: Verify + commit**

`npx tsc --noEmit` clean (JSX/React types resolve); `npx vitest run` green; `npx next build` → `/miniapp` builds (a client page). Do a quick manual read of the build output to confirm `/miniapp` appears.
```bash
git add app/miniapp/layout.tsx app/miniapp/page.tsx
git commit -m "feat(miniapp): settings page (timezone, digest window, pause, reconnect, rules)"
```

---

### Task 6: Bot menu button + `/settings` command

**Files:**
- Modify: `src/telegram/bot.ts` (`ensureTelegramWebhook` sets the menu button + adds `/settings`; `handleMessage` answers `/settings`)

- [ ] **Step 1: In `src/telegram/bot.ts`, extend `ensureTelegramWebhook`**

After the existing `setWebhook`, set the chat menu button to open the mini app and add the `/settings` command:
```ts
  await bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Settings", web_app: { url: `${env.APP_BASE_URL}/miniapp` } },
  });
  await bot.api.setMyCommands([
    { command: "start", description: "What I do and how to talk to me" },
    { command: "help", description: "Show what I can do" },
    { command: "settings", description: "Open your settings" },
  ]);
```
(Replace the existing `setMyCommands` call — do not add a second one.)

- [ ] **Step 2: Answer `/settings` in `handleMessage`**

Extend the command shortcut at the top of `handleMessage`:
```ts
  const cmd = text.trim().split(/\s+/)[0]?.toLowerCase().split("@")[0];
  if (cmd === "/start" || cmd === "/help") return INTRO;
  if (cmd === "/settings") return "Tap the ⚙️ Settings button at the bottom-left of the chat to open your settings.";
```

- [ ] **Step 3: Verify + commit**

`npx tsc --noEmit` clean; `npx vitest run` green (the existing `commands`/allowlist tests still pass — `/settings` is an added branch, `/start`/`/help` unchanged); `npx next build` succeeds.
```bash
git add src/telegram/bot.ts
git commit -m "feat(telegram): menu button opens the mini app + /settings command"
```

---

## Self-Review

**Spec coverage (spec §7):**
- `/miniapp` client page reading initData → Task 5. ✓
- initData HMAC verification (server, unit-tested) → Task 1. ✓
- `GET/POST /api/settings` + `POST /api/settings/reconnect`, all initData-gated → Tasks 3, 4. ✓
- UI: timezone, digest window, pause, Gmail status + Reconnect, read-only rules → Task 5. ✓
- Bot menu button + `/settings` → Task 6. ✓
- Reuse of C1/C2/B modules (no logic duplication) → Tasks 2–4. ✓

**Placeholder scan:** No TBD/TODO; complete code in every step. ✓

**Type consistency:** `verifyInitData → {telegramUserId}`, `resolveUserIdForApp(owner, tgId, links, directory)`, `SettingsView`/`SettingsPatch`, `buildSettingsView(eff, account, rules)`, `validateSettingsPatch`, `mergePatch(eff, patch)`, `GoogleAccountRepo.getStatus` are consistent across definitions, tests, and the routes/page. The page's `View` type mirrors `SettingsView`. ✓

**Security review:** Every API route verifies initData and resolves the user server-side; no client-supplied user id is trusted. initData verification is timing-safe, freshness-checked, and unit-tested for tamper/wrong-token/expiry. The reconnect endpoint reuses C2's one-time state. ✓

## Execution Handoff

After all tasks pass, run a whole-branch adversarial review (the initData auth boundary + the fact that every route is genuinely gated are the key risks — confirm no route path bypasses verification, and that a valid but unlinked non-owner is rejected), then merge to `main` via `superpowers:finishing-a-development-branch`. This completes the Next.js + Mini App + multi-user arc.
