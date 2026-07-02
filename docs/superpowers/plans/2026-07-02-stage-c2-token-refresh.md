# Stage C2: Token-Refresh Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gmail auth durable and self-healing: persist rotated refresh tokens, detect a dead token and prompt re-consent (once), verify the OAuth `state` (CSRF), and make the OAuth flow user-aware (state → userId) so re-connect works per user.

**Architecture:** A `needs_reconnect` flag on `google_accounts` + an `oauth_states` table (one-time, TTL'd, user-bound). Pure helpers (`isInvalidGrant`, `isStateFresh`, `reconnectNudgeText`) + thin repos (`OAuthStateRepo`, `GoogleAccountRepo`). `authedGmailFor` gains an `on("tokens")` listener that re-persists a rotated refresh token. The poll detects `invalid_grant`, marks the account (transition-once), and nudges the user. `exchangeAndStore` binds the token to a caller-supplied `userId` (from the verified state), replacing the "attach to the first user" assumption.

**Tech Stack:** TypeScript (bundler resolution), Drizzle (Neon), `google-auth-library`, AES-256-GCM (existing `src/lib/crypto.ts`), Vitest, Next.js App Router.

## Global Constraints

- Node `>=20`, ESM, explicit `.js` import extensions, bundler resolution; preserve `strict` + `noUncheckedIndexedAccess`.
- **OAuth flow behavior-preservation:** the owner's existing connect / re-consent flow must keep working. Initial setup (no user yet) still bootstraps a user; re-consent updates the existing account. The ONLY additions are: `state` is stored and verified, `exchangeAndStore` takes an explicit `userId`, and a successful connect clears `needs_reconnect`.
- OAuth scope stays exactly `https://www.googleapis.com/auth/gmail.modify`.
- `TOKEN_ENC_KEY` is never rotated; secrets never logged. A rotated refresh token is re-encrypted with the SAME key.
- The callback MUST reject a request whose `state` is missing, unknown, or expired (one-time use — the row is deleted on consume regardless).
- The reconnect nudge is sent **at most once per disconnection** (only on the `false → true` transition of `needs_reconnect`), never every poll.
- Migration `0005` is additive (new `oauth_states` table + a `needs_reconnect` column defaulting to `false` on existing rows); it must not alter/drop other tables.
- All existing tests stay green; `npx next build` (typecheck) is a required gate. Do NOT run `npm run vercel-build` locally. Verify with `npx tsc --noEmit`, `npx vitest run`, `npx next build`.

---

### Task 1: Schema — `needs_reconnect` + `oauth_states` (migration 0005)

**Files:**
- Modify: `src/db/schema.ts`
- Create: migration via `npm run db:generate` (commit `drizzle/0005_*.sql` + `drizzle/meta`)

**Interfaces:**
- Produces: the `oauthStates` table + `googleAccounts.needsReconnect` column referenced by later tasks.

- [ ] **Step 1: Edit `src/db/schema.ts`**

Add `needsReconnect` to the existing `googleAccounts` table (after `scope`):
```ts
export const googleAccounts = pgTable("google_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  encRefreshToken: text("enc_refresh_token").notNull(),
  scope: text("scope").notNull(),
  needsReconnect: boolean("needs_reconnect").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```
Add a new `oauthStates` table (after `telegramLinks`):
```ts
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: `drizzle/0005_<name>.sql` with exactly (a) `ALTER TABLE "google_accounts" ADD COLUMN "needs_reconnect" boolean DEFAULT false NOT NULL;` and (b) `CREATE TABLE ... "oauth_states" (...)` + its FK to users. Offline diff — no DB connection. INSPECT the SQL; confirm no other table is altered/dropped. If anything else appears, STOP and report BLOCKED with the SQL.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass. `npx next build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): google_accounts.needs_reconnect + oauth_states table"
```

---

### Task 2: Pure helpers + reconnect/state repos

**Files:**
- Create: `src/oauth/reconnect.ts` (pure helpers + repo interfaces + fakes)
- Create: `tests/oauth/reconnect.test.ts`
- Create: `src/db/oauth-state-adapter.ts`
- Create: `src/db/google-account-adapter.ts`
- Create: `tests/db/oauth-adapters.contract.test.ts`

**Interfaces:**
- Produces: `isInvalidGrant`, `isStateFresh`, `reconnectNudgeText`, `OAUTH_STATE_TTL_MS`, `OAuthStateRepo`, `GoogleAccountRepo`, `fakeOAuthStateRepo`, `fakeGoogleAccountRepo`, `dbOAuthStateRepo`, `dbGoogleAccountRepo`. Consumed by Tasks 3, 4.

- [ ] **Step 1: Write failing tests** `tests/oauth/reconnect.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  isInvalidGrant, isStateFresh, reconnectNudgeText, OAUTH_STATE_TTL_MS,
  fakeOAuthStateRepo, fakeGoogleAccountRepo,
} from "../../src/oauth/reconnect.js";

describe("isInvalidGrant", () => {
  it("detects invalid_grant across error shapes", () => {
    expect(isInvalidGrant({ message: "invalid_grant" })).toBe(true);
    expect(isInvalidGrant({ response: { data: { error: "invalid_grant" } } })).toBe(true);
    expect(isInvalidGrant({ message: "Error: invalid_grant (Token has been expired or revoked.)" })).toBe(true);
  });
  it("is false for unrelated errors", () => {
    expect(isInvalidGrant({ message: "network timeout" })).toBe(false);
    expect(isInvalidGrant(null)).toBe(false);
    expect(isInvalidGrant(new Error("rate limit"))).toBe(false);
  });
});

describe("isStateFresh", () => {
  it("is true within the TTL, false after", () => {
    const created = new Date("2026-07-02T12:00:00Z");
    expect(isStateFresh(created, new Date(created.getTime() + OAUTH_STATE_TTL_MS - 1))).toBe(true);
    expect(isStateFresh(created, new Date(created.getTime() + OAUTH_STATE_TTL_MS + 1))).toBe(false);
  });
});

describe("reconnectNudgeText", () => {
  it("includes the email when present", () => {
    expect(reconnectNudgeText("a@b.com")).toContain("a@b.com");
    expect(reconnectNudgeText()).not.toContain("(");
  });
});

describe("fakeOAuthStateRepo", () => {
  it("create then consume returns the userId once, then null (one-time use)", async () => {
    const repo = fakeOAuthStateRepo();
    const now = new Date("2026-07-02T12:00:00Z");
    await repo.create("s1", 7);
    expect(await repo.consume("s1", now)).toBe(7);
    expect(await repo.consume("s1", now)).toBeNull();           // already consumed
  });
  it("consume returns null for an expired state (and still deletes it)", async () => {
    const repo = fakeOAuthStateRepo();
    await repo.create("s2", 7, new Date("2026-07-02T12:00:00Z"));
    const late = new Date("2026-07-02T12:00:00Z").getTime() + OAUTH_STATE_TTL_MS + 1000;
    expect(await repo.consume("s2", new Date(late))).toBeNull();
    expect(await repo.consume("s2", new Date(late))).toBeNull(); // gone
  });
  it("consume returns null for an unknown state", async () => {
    expect(await fakeOAuthStateRepo().consume("nope", new Date())).toBeNull();
  });
});

describe("fakeGoogleAccountRepo", () => {
  it("markNeedsReconnect transitions false→true once (returns true), then false", async () => {
    const repo = fakeGoogleAccountRepo({ 1: false });
    expect(await repo.markNeedsReconnect(1)).toBe(true);   // newly set
    expect(await repo.markNeedsReconnect(1)).toBe(false);  // already set → no re-nudge
  });
  it("clearNeedsReconnect resets it", async () => {
    const repo = fakeGoogleAccountRepo({ 1: true });
    await repo.clearNeedsReconnect(1);
    expect(await repo.markNeedsReconnect(1)).toBe(true);   // was cleared, so transitions again
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/oauth/reconnect.test.ts`
Expected: FAIL — cannot resolve `../../src/oauth/reconnect.js`.

- [ ] **Step 3: Implement `src/oauth/reconnect.ts`**

```ts
// Pure helpers + repo interfaces for token re-connect handling.
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export function isInvalidGrant(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { message?: unknown; code?: unknown; response?: { data?: { error?: unknown } } };
  if (e.code === "invalid_grant") return true;
  if (e.response?.data?.error === "invalid_grant") return true;
  return typeof e.message === "string" && /invalid_grant/i.test(e.message);
}

export function isStateFresh(createdAt: Date, now: Date, ttlMs: number = OAUTH_STATE_TTL_MS): boolean {
  return now.getTime() - createdAt.getTime() < ttlMs;
}

export function reconnectNudgeText(email?: string): string {
  return `⚠️ I lost access to your Gmail${email ? ` (${email})` : ""}. Please reconnect it in Settings to keep getting briefs.`;
}

export interface OAuthStateRepo {
  create(state: string, userId: number): Promise<void>;
  consume(state: string, now: Date): Promise<number | null>; // one-time: deletes the row; returns userId only if fresh
}

export interface GoogleAccountRepo {
  markNeedsReconnect(userId: number): Promise<boolean>;  // true iff it transitioned false→true (nudge only then)
  clearNeedsReconnect(userId: number): Promise<void>;
  updateRefreshToken(userId: number, encRefreshToken: string): Promise<void>;
}

export function fakeOAuthStateRepo(): OAuthStateRepo & { create(state: string, userId: number, createdAt?: Date): Promise<void> } {
  const rows = new Map<string, { userId: number; createdAt: Date }>();
  return {
    // Params annotated explicitly: the return-type intersection adds a 3rd `createdAt`
    // to the `create` name, which defeats TS contextual typing (would infer `unknown`).
    async create(state: string, userId: number, createdAt: Date = new Date("2026-07-02T12:00:00Z")) { rows.set(state, { userId, createdAt }); },
    async consume(state, now) {
      const row = rows.get(state);
      rows.delete(state);                            // one-time use, deleted regardless of freshness
      if (!row) return null;
      return isStateFresh(row.createdAt, now) ? row.userId : null;
    },
  };
}

export function fakeGoogleAccountRepo(seed: Record<number, boolean> = {}): GoogleAccountRepo & { flag(userId: number): boolean } {
  const needs: Record<number, boolean> = { ...seed };
  return {
    async markNeedsReconnect(userId) { if (needs[userId]) return false; needs[userId] = true; return true; },
    async clearNeedsReconnect(userId) { needs[userId] = false; },
    async updateRefreshToken() { /* no-op in fake */ },
    flag(userId) { return needs[userId] ?? false; },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/oauth/reconnect.test.ts`
Expected: PASS (all cases). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Implement `src/db/oauth-state-adapter.ts`**

```ts
// src/db/oauth-state-adapter.ts
import { eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { OAuthStateRepo } from "../oauth/reconnect.js";
import { isStateFresh } from "../oauth/reconnect.js";

export function dbOAuthStateRepo(): OAuthStateRepo {
  return {
    async create(state, userId) {
      await db().insert(schema.oauthStates).values({ state, userId });
    },
    async consume(state, now) {
      // Atomic one-time use: DELETE ... RETURNING, so only the caller that actually
      // removed the row receives it — a concurrent duplicate/replay gets no row (null).
      // A select-then-delete would have a TOCTOU gap that allows state replay.
      const [row] = await db().delete(schema.oauthStates)
        .where(eq(schema.oauthStates.state, state))
        .returning({ userId: schema.oauthStates.userId, createdAt: schema.oauthStates.createdAt });
      if (!row) return null;
      return isStateFresh(row.createdAt, now) ? row.userId : null;
    },
  };
}
```

- [ ] **Step 6: Implement `src/db/google-account-adapter.ts`**

```ts
// src/db/google-account-adapter.ts
import { and, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { GoogleAccountRepo } from "../oauth/reconnect.js";

export function dbGoogleAccountRepo(): GoogleAccountRepo {
  return {
    async markNeedsReconnect(userId) {
      // Atomic transition false→true: only rows currently false are updated, so a returned
      // row means we just transitioned (nudge once). Already-true rows update nothing.
      const rows = await db().update(schema.googleAccounts)
        .set({ needsReconnect: true, updatedAt: new Date() })
        .where(and(eq(schema.googleAccounts.userId, userId), eq(schema.googleAccounts.needsReconnect, false)))
        .returning({ id: schema.googleAccounts.id });
      return rows.length > 0;
    },
    async clearNeedsReconnect(userId) {
      await db().update(schema.googleAccounts).set({ needsReconnect: false, updatedAt: new Date() })
        .where(eq(schema.googleAccounts.userId, userId));
    },
    async updateRefreshToken(userId, encRefreshToken) {
      await db().update(schema.googleAccounts).set({ encRefreshToken, updatedAt: new Date() })
        .where(eq(schema.googleAccounts.userId, userId));
    },
  };
}
```

- [ ] **Step 7: DB contract test** `tests/db/oauth-adapters.contract.test.ts`:
```ts
import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("oauth adapters (DB contract)", () => {
  it("oauth_states create → consume is one-time", async () => {
    const { dbOAuthStateRepo } = await import("../../src/db/oauth-state-adapter.js");
    const repo = dbOAuthStateRepo();
    const s = `st_${Math.floor(Date.now() % 1e9)}`;
    await repo.create(s, 1);
    expect(await repo.consume(s, new Date())).toBe(1);
    expect(await repo.consume(s, new Date())).toBeNull();
  });
  it("markNeedsReconnect transitions once then clear resets", async () => {
    const { dbGoogleAccountRepo } = await import("../../src/db/google-account-adapter.js");
    const repo = dbGoogleAccountRepo();
    await repo.clearNeedsReconnect(1);                 // baseline: false (requires a google_accounts row for user 1)
    expect(await repo.markNeedsReconnect(1)).toBe(true);
    expect(await repo.markNeedsReconnect(1)).toBe(false);
    await repo.clearNeedsReconnect(1);
  });
});
```

- [ ] **Step 8: Verify + commit**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass (contract skipped). `npx next build` → succeeds.
```bash
git add src/oauth/reconnect.ts tests/oauth/reconnect.test.ts src/db/oauth-state-adapter.ts src/db/google-account-adapter.ts tests/db/oauth-adapters.contract.test.ts
git commit -m "feat(oauth): reconnect helpers + oauth_state/google_account repos"
```

---

### Task 3: State CSRF + user-aware OAuth flow

**Files:**
- Modify: `src/oauth/google.ts` (`exchangeAndStore(env, code, userId)`, new `ensureBootstrapUser`)
- Modify: `app/api/oauth/start/route.ts`
- Modify: `app/api/oauth/callback/route.ts`
- Modify: `tests/oauth/google.test.ts` (update the `exchangeAndStore` call if referenced; if the test only checks `SCOPE`/`buildAuthUrl`, leave those and add nothing)

**Interfaces:**
- Consumes: `dbOAuthStateRepo` (Task 2).
- Produces: `exchangeAndStore(env, code, userId): Promise<{email}>`, `ensureBootstrapUser(): Promise<number>`.

- [ ] **Step 1: Update `src/oauth/google.ts`**

Add `ensureBootstrapUser` and change `exchangeAndStore` to take an explicit `userId` (replacing the "first user" bootstrap inside it); clear `needsReconnect` on the update path. Replace the existing `exchangeAndStore` function and add `ensureBootstrapUser`:
```ts
export async function ensureBootstrapUser(): Promise<number> {
  const [user] = await db().select().from(schema.users).limit(1);
  return user?.id ?? (await db().insert(schema.users).values({}).returning())[0]!.id;
}

export async function exchangeAndStore(env: Env, code: string, userId: number): Promise<{ email: string }> {
  const client = oauthClient(env);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("no refresh_token (re-consent with prompt=consent)");
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) throw new Error("could not resolve account email from gmail profile");
  const enc = encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY);
  const existing = await db().select().from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
  if (existing[0]) {
    await db().update(schema.googleAccounts)
      .set({ encRefreshToken: enc, email, needsReconnect: false, updatedAt: new Date() })
      .where(eq(schema.googleAccounts.id, existing[0].id));
  } else {
    await db().insert(schema.googleAccounts).values({ userId, email, encRefreshToken: enc, scope: SCOPE });
  }
  return { email };
}
```

- [ ] **Step 2: Update `app/api/oauth/start/route.ts`** (bind a stored state to the bootstrap user)

```ts
// app/api/oauth/start/route.ts — begins the Google OAuth consent flow (owner-guarded).
// Visit https://<app>/api/oauth/start?key=<SETUP_SECRET> in a browser once to connect Gmail.
import { randomBytes } from "node:crypto";
import { env } from "../../../../src/config/env.js";
import { buildAuthUrl, ensureBootstrapUser } from "../../../../src/oauth/google.js";
import { isSetupAuthorized } from "../../../../src/setup/auth.js";
import { searchParam } from "../../../../src/http/url.js";
import { dbOAuthStateRepo } from "../../../../src/db/oauth-state-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const e = env();
  const expected = e.SETUP_SECRET;
  if (!expected) return new Response("setup not configured (SETUP_SECRET unset)", { status: 500 });
  const key = searchParam(req.url, "key");
  if (!isSetupAuthorized(key, expected)) return new Response("forbidden", { status: 403 });
  const userId = await ensureBootstrapUser();
  const state = randomBytes(16).toString("hex");
  await dbOAuthStateRepo().create(state, userId);
  return new Response(null, { status: 302, headers: { Location: buildAuthUrl(e, state) } });
}
```

- [ ] **Step 3: Update `app/api/oauth/callback/route.ts`** (verify + consume state, bind token to its userId)

```ts
// app/api/oauth/callback/route.ts
import { env } from "../../../../src/config/env.js";
import { exchangeAndStore } from "../../../../src/oauth/google.js";
import { searchParam } from "../../../../src/http/url.js";
import { dbOAuthStateRepo } from "../../../../src/db/oauth-state-adapter.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const code = searchParam(req.url, "code");
  const state = searchParam(req.url, "state");
  if (!code || !state) return new Response("missing code or state", { status: 400 });
  const userId = await dbOAuthStateRepo().consume(state, new Date());
  if (userId === null) return new Response("invalid or expired state", { status: 403 });
  try {
    const { email } = await exchangeAndStore(env(), code, userId);
    return new Response(`Connected ${email}. You can close this tab.`, { status: 200 });
  } catch (e) {
    console.error("oauth callback error", e);
    return new Response("OAuth failed — check the server logs.", { status: 500 });
  }
}
```

- [ ] **Step 4: Reconcile `tests/oauth/google.test.ts`**

Read `tests/oauth/google.test.ts`. If it calls `exchangeAndStore` with the old 2-arg signature, update those calls to pass a `userId` (the tests use fakes/mocks — pass `1`). If it only asserts `SCOPE`/`buildAuthUrl` behavior (no `exchangeAndStore` call), make NO change. Do not weaken any existing assertion.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass. `npx next build` → succeeds; `/api/oauth/start` + `/api/oauth/callback` still dynamic.
```bash
git add src/oauth/google.ts app/api/oauth/start/route.ts app/api/oauth/callback/route.ts tests/oauth/google.test.ts
git commit -m "feat(oauth): verify state (CSRF) + bind token to the state's user"
```

---

### Task 4: Rotation persistence + invalid_grant nudge

**Files:**
- Modify: `src/oauth/google.ts` (`authedGmailFor` → persist rotated refresh token)
- Modify: `app/api/poll/route.ts` (detect `invalid_grant` in `pollUser` → mark + nudge once)

**Interfaces:**
- Consumes: `isInvalidGrant`, `reconnectNudgeText`, `dbGoogleAccountRepo` (Task 2).

- [ ] **Step 1: Persist rotated refresh tokens in `authedGmailFor`**

In `src/oauth/google.ts`, add an `on("tokens")` listener to the client built in `authedGmailFor`, re-encrypting and persisting any rotated refresh token (fire-and-forget; failure is logged, never thrown). Replace `authedGmailFor` with:
```ts
export async function authedGmailFor(userId: number, env: Env): Promise<OAuth2Client> {
  const [acct] = await db().select().from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
  if (!acct) throw new Error("no google account linked");
  const client = oauthClient(env);
  client.setCredentials({ refresh_token: decryptSecret(acct.encRefreshToken, env.TOKEN_ENC_KEY) });
  // Google occasionally rotates the refresh token; persist the new one so it never goes stale.
  client.on("tokens", (tokens) => {
    if (!tokens.refresh_token) return;
    const enc = encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY);
    void db().update(schema.googleAccounts).set({ encRefreshToken: enc, updatedAt: new Date() })
      .where(eq(schema.googleAccounts.id, acct.id))
      .catch((e) => console.error("failed to persist rotated refresh token", e));
  });
  return client;
}
```

- [ ] **Step 2: Detect `invalid_grant` in the poll and nudge once**

In `app/api/poll/route.ts`, add imports and wrap the `pollUser` body so a dead token marks the account and nudges the user exactly once. Add imports:
```ts
import { dbGoogleAccountRepo } from "../../../src/db/google-account-adapter.js";
import { isInvalidGrant, reconnectNudgeText } from "../../../src/oauth/reconnect.js";
```
Change the `pollUser` closure to:
```ts
    pollUser: async (userId, chatId, timezone) => {
      try {
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
      } catch (err) {
        if (isInvalidGrant(err)) {
          const newlyFlagged = await dbGoogleAccountRepo().markNeedsReconnect(userId);
          if (newlyFlagged) await sendFormatted(bot, chatId, reconnectNudgeText());
          return; // handled; do not advance the cursor (res.commit only runs on success above)
        }
        throw err; // let the fan-out isolate and count other errors
      }
    },
```
Note: on `invalid_grant`, `res.commit()` was never reached, so the cursor stays frozen — the accumulated mail is delivered after reconnect. The nudge fires only on the `false → true` transition.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass. `npx next build` → succeeds; `/api/poll` still dynamic.
```bash
git add src/oauth/google.ts app/api/poll/route.ts
git commit -m "feat(oauth): persist rotated refresh tokens + reconnect nudge on invalid_grant"
```

---

## Self-Review

**Spec coverage (spec §6.3):**
- Persist rotation via `on("tokens")` → Task 4 Step 1. ✓
- Detect `invalid_grant` → mark `needs_reconnect` + Telegram nudge (once) → Task 2 (`isInvalidGrant`, `markNeedsReconnect` transition) + Task 4 Step 2. ✓
- `state` CSRF: persist in `oauth_states` bound to a `userId`; verify on callback → Task 1 (table) + Task 2 (repo) + Task 3 (start/callback). ✓
- User-aware OAuth: `state → userId`; `exchangeAndStore` binds to that user → Task 3. ✓
- Reconnect (mini app) infrastructure ready: `dbOAuthStateRepo` + user-aware `exchangeAndStore` are what Stage D's reconnect endpoint will reuse. ✓

**Placeholder scan:** No TBD/TODO; full code in every step; the migration's expected SQL is named in Task 1 Step 2; Task 3 Step 4 gives a concrete rule for the test reconciliation. ✓

**Type consistency:** `OAuthStateRepo.consume(state, now)`, `GoogleAccountRepo.markNeedsReconnect → Promise<boolean>`, `isInvalidGrant`, `reconnectNudgeText`, `exchangeAndStore(env, code, userId)`, `ensureBootstrapUser(): Promise<number>` are consistent across definitions, fakes, tests, and call sites. ✓

**Behavior-preservation:** initial connect (no user) → `ensureBootstrapUser` creates user 1, state bound to 1, callback binds token to 1 → same end state as the old flow; re-consent → updates user 1's account + clears `needs_reconnect`. The only new rejection is an unverified/expired `state` (which the owner's own start flow always provides fresh). ✓

## Execution Handoff

After all tasks pass, run a whole-branch adversarial review (the OAuth flow is safety-critical — confirm the owner's connect/re-consent path still works end-to-end, the callback rejects forged/expired state, the rotated-token listener can't throw or log secrets, and the nudge can't spam), then merge to `main` via `superpowers:finishing-a-development-branch`. Stage D (Telegram Mini App) branches off the merged `main` and consumes `dbSettingsRepo` (C1) + `dbOAuthStateRepo` + user-aware OAuth (C2).
