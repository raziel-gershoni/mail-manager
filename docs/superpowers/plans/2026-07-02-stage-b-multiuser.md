# Stage B: Multi-User Plumbing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app correctly multi-tenant — resolve the acting user from `telegram_links` instead of a hardcoded `USER_ID = 1`, fan the poll out over all users with a linked Google account, and route each user's briefs to their own chat — while staying behavior-identical for the single existing owner.

**Architecture:** A new pure identity module (`src/users/identity.ts`) holds the resolution/authorization/owner-bootstrap logic over repo interfaces; DB adapters implement those repos; a testable fan-out orchestrator (`src/notifier/fanout.ts`) replaces the poll route's single-user body; the three route handlers are rewired to use them. `runPoll`, `dbMemoryStore`, and the whole `src/**` classification/agent core are already `userId`-parameterized and need no change. Owner-curated — no self-serve onboarding.

**Tech Stack:** TypeScript (bundler resolution), Drizzle (Neon), Vitest, Next.js App Router.

## Global Constraints

- Node `>=20`, ESM, explicit `.js` import extensions, `bundler` resolution.
- **Behavior-preserving for the owner:** with one user + one Google account today, the owner must keep receiving briefs at `TELEGRAM_OWNER_ID` and keep being the only authorized Telegram sender. No user-visible change.
- Owner-curated multi-user: new users are added out-of-band (DB rows). **No self-serve OAuth/onboarding.**
- Authorization is now "the Telegram id equals `TELEGRAM_OWNER_ID`, OR it has a row in `telegram_links`." Never authorize an unlinked, non-owner id.
- OAuth scope untouched (`gmail.modify`); no change to the agent toolset, classification, or trash rail.
- `telegram_links.telegram_user_id` gets a UNIQUE index so lazy upserts are race-safe (`telegram_links` is currently empty, so the index applies cleanly).
- Private-chat identity assumption: for a Telegram private chat, `chat.id === from.id`, so the owner's `chat_id` bootstraps to `TELEGRAM_OWNER_ID`.
- All existing tests stay green; `npx next build` (typecheck) is a required gate. Do NOT run `npm run vercel-build` locally (it migrates the real DB); verify with `npx tsc --noEmit`, `npx vitest run`, `npx next build`.
- Secrets never logged.

---

### Task 1: Identity module (resolution + authorization + owner bootstrap)

Pure logic over repo interfaces — no DB, fully unit-tested with fakes.

**Files:**
- Create: `src/users/identity.ts`
- Create: `tests/users/identity.test.ts`
- Modify: `src/memory/store.ts` (parameterize the in-memory fake's `userId`)

**Interfaces:**
- Produces: `TelegramLink`, `TelegramLinkRepo`, `UserDirectory`, `fakeTelegramLinkRepo`, `fakeUserDirectory`, `resolveUserForTelegram`, `isAuthorizedTelegram`, `ensureOwnerLink` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Write the failing tests**

`tests/users/identity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  fakeTelegramLinkRepo, fakeUserDirectory,
  resolveUserForTelegram, isAuthorizedTelegram, ensureOwnerLink,
} from "../../src/users/identity.js";

const OWNER = 555;

describe("resolveUserForTelegram", () => {
  it("returns the linked userId for an existing link (no owner fallback)", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 7, telegramUserId: 999, chatId: 999 }]);
    const dir = fakeUserDirectory([7]);
    expect(await resolveUserForTelegram(OWNER, 999, 999, links, dir)).toBe(7);
  });
  it("bootstraps the owner: resolves to the owner user and upserts a link with the real chatId", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([3]); // owner user = min id with a google account
    expect(await resolveUserForTelegram(OWNER, OWNER, OWNER, links, dir)).toBe(3);
    expect(links.all()).toEqual([{ userId: 3, telegramUserId: OWNER, chatId: OWNER }]);
  });
  it("returns null for an unlinked non-owner id (not authorized)", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([3]);
    expect(await resolveUserForTelegram(OWNER, 123, 123, links, dir)).toBeNull();
    expect(links.all()).toEqual([]);
  });
  it("returns null when the owner messages but no user is bootstrapped yet", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([]); // no google account exists
    expect(await resolveUserForTelegram(OWNER, OWNER, OWNER, links, dir)).toBeNull();
  });
});

describe("isAuthorizedTelegram", () => {
  it("authorizes the owner id without a DB read", async () => {
    const links = fakeTelegramLinkRepo([]);
    expect(await isAuthorizedTelegram(OWNER, OWNER, links)).toBe(true);
  });
  it("authorizes a linked non-owner id", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 7, telegramUserId: 999, chatId: 999 }]);
    expect(await isAuthorizedTelegram(OWNER, 999, links)).toBe(true);
  });
  it("rejects an unlinked non-owner id", async () => {
    const links = fakeTelegramLinkRepo([]);
    expect(await isAuthorizedTelegram(OWNER, 123, links)).toBe(false);
  });
});

describe("ensureOwnerLink", () => {
  it("creates the owner link (chatId = ownerTelegramId) when missing", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([4]);
    await ensureOwnerLink(OWNER, links, dir);
    expect(links.all()).toEqual([{ userId: 4, telegramUserId: OWNER, chatId: OWNER }]);
  });
  it("is a no-op when the owner link already exists", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 4, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([4]);
    await ensureOwnerLink(OWNER, links, dir);
    expect(links.all().length).toBe(1);
  });
  it("is a no-op when no user is bootstrapped", async () => {
    const links = fakeTelegramLinkRepo([]);
    const dir = fakeUserDirectory([]);
    await ensureOwnerLink(OWNER, links, dir);
    expect(links.all()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/users/identity.test.ts`
Expected: FAIL — cannot resolve `../../src/users/identity.js`.

- [ ] **Step 3: Implement `src/users/identity.ts`**

```ts
// Identity resolution for multi-user routing. Pure logic over repo interfaces.
export interface TelegramLink { userId: number; telegramUserId: number; chatId: number; }

export interface TelegramLinkRepo {
  getByTelegramUserId(telegramUserId: number): Promise<{ userId: number; chatId: number } | null>;
  getByUserId(userId: number): Promise<{ telegramUserId: number; chatId: number } | null>;
  upsert(link: TelegramLink): Promise<void>;
}

export interface UserDirectory {
  usersWithGoogleAccount(): Promise<number[]>;
  ownerUserId(): Promise<number | null>; // the bootstrap owner: lowest user id that has a Google account
}

// Resolve the acting user for an inbound Telegram message, or null if unauthorized.
// A known link wins. Otherwise, only the owner id bootstraps — lazily creating the
// owner's link (capturing the real chatId). Unlinked non-owner ids get null.
export async function resolveUserForTelegram(
  ownerTelegramId: number, telegramUserId: number, chatId: number,
  links: TelegramLinkRepo, directory: UserDirectory,
): Promise<number | null> {
  const existing = await links.getByTelegramUserId(telegramUserId);
  if (existing) return existing.userId;
  if (telegramUserId === ownerTelegramId) {
    const ownerUserId = await directory.ownerUserId();
    if (ownerUserId === null) return null;
    await links.upsert({ userId: ownerUserId, telegramUserId, chatId });
    return ownerUserId;
  }
  return null;
}

// Cheap authorization gate (read-only). Owner short-circuits with no DB read.
export async function isAuthorizedTelegram(
  ownerTelegramId: number, telegramUserId: number, links: TelegramLinkRepo,
): Promise<boolean> {
  if (telegramUserId === ownerTelegramId) return true;
  return (await links.getByTelegramUserId(telegramUserId)) !== null;
}

// Ensure the owner has a telegram_links row so the poll can deliver briefs even
// before the owner next messages the bot. chatId bootstraps to ownerTelegramId
// (private-chat identity: chat.id === from.id).
export async function ensureOwnerLink(
  ownerTelegramId: number, links: TelegramLinkRepo, directory: UserDirectory,
): Promise<void> {
  if (await links.getByTelegramUserId(ownerTelegramId)) return;
  const ownerUserId = await directory.ownerUserId();
  if (ownerUserId === null) return;
  await links.upsert({ userId: ownerUserId, telegramUserId: ownerTelegramId, chatId: ownerTelegramId });
}

export function fakeTelegramLinkRepo(seed: TelegramLink[] = []): TelegramLinkRepo & { all(): TelegramLink[] } {
  const rows: TelegramLink[] = [...seed];
  return {
    async getByTelegramUserId(tg) { const r = rows.find(x => x.telegramUserId === tg); return r ? { userId: r.userId, chatId: r.chatId } : null; },
    async getByUserId(uid) { const r = rows.find(x => x.userId === uid); return r ? { telegramUserId: r.telegramUserId, chatId: r.chatId } : null; },
    async upsert(link) { const i = rows.findIndex(x => x.telegramUserId === link.telegramUserId); if (i >= 0) rows[i] = link; else rows.push(link); },
    all() { return [...rows]; },
  };
}

export function fakeUserDirectory(userIds: number[] = []): UserDirectory {
  return {
    async usersWithGoogleAccount() { return [...userIds]; },
    async ownerUserId() { return userIds.length ? Math.min(...userIds) : null; },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/users/identity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Parameterize the in-memory memory-store fake's userId**

In `src/memory/store.ts`, change the `inMemoryStore` signature to accept an optional `userId` (default `1`, so all existing callers are unaffected) and use it for newly created rows.

Change the signature line:
```ts
export function inMemoryStore(seed: MemoryRow[] = []): MemoryStore {
  const rows: MemoryRow[] = [...seed];
```
to:
```ts
export function inMemoryStore(seed: MemoryRow[] = [], userId = 1): MemoryStore {
  const rows: MemoryRow[] = [...seed];
```
Then in both `upsertSenderRule` and `upsertRule`, replace the literal `userId: 1` in the new-row object with `userId`:
```ts
        row = { userId, slug, description, body: "", scope: "sender", matchType: "sender", matchValue: fromEmail, verdict };
```
```ts
      if (!row) { row = { userId, slug, description, body: "", scope, matchType: scope, matchValue, verdict }; rows.push(row); }
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all pass (the `inMemoryStore` default `userId = 1` preserves existing behavior). Then `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/users/identity.ts tests/users/identity.test.ts src/memory/store.ts
git commit -m "feat(users): identity resolution + owner-bootstrap module"
```

---

### Task 2: DB layer for identity (unique index + adapters)

**Files:**
- Modify: `src/db/schema.ts` (unique index on `telegram_links.telegram_user_id`)
- Create: migration via `npm run db:generate` (offline; commit the generated `drizzle/0003_*.sql` + `drizzle/meta` updates)
- Create: `src/db/user-adapters.ts`
- Create: `tests/db/user-adapters.contract.test.ts`

**Interfaces:**
- Consumes: `TelegramLinkRepo`, `UserDirectory`, `TelegramLink` from Task 1.
- Produces: `dbTelegramLinkRepo(): TelegramLinkRepo`, `dbUserDirectory(): UserDirectory` — consumed by Tasks 3, 4.

- [ ] **Step 1: Add the unique index to the schema**

In `src/db/schema.ts`, change the `telegramLinks` table definition to add a unique index on `telegramUserId`:
```ts
export const telegramLinks = pgTable("telegram_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
}, (t) => ({ tgUserUx: uniqueIndex("telegram_links_tg_user_ux").on(t.telegramUserId) }));
```
(`uniqueIndex` is already imported at the top of the file.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: creates `drizzle/0003_<name>.sql` containing `CREATE UNIQUE INDEX "telegram_links_tg_user_ux" ON "telegram_links" ("telegram_user_id");` and updates `drizzle/meta/`. This is an offline schema diff — it does not touch any database. Inspect the generated SQL to confirm it is ONLY the new index (no unexpected drops).

- [ ] **Step 3: Implement `src/db/user-adapters.ts`**

```ts
// src/db/user-adapters.ts
import { eq, min } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { TelegramLink, TelegramLinkRepo, UserDirectory } from "../users/identity.js";

export function dbTelegramLinkRepo(): TelegramLinkRepo {
  return {
    async getByTelegramUserId(telegramUserId) {
      const [r] = await db().select().from(schema.telegramLinks)
        .where(eq(schema.telegramLinks.telegramUserId, telegramUserId)).limit(1);
      return r ? { userId: r.userId, chatId: r.chatId } : null;
    },
    async getByUserId(userId) {
      const [r] = await db().select().from(schema.telegramLinks)
        .where(eq(schema.telegramLinks.userId, userId)).limit(1);
      return r ? { telegramUserId: r.telegramUserId, chatId: r.chatId } : null;
    },
    async upsert(link: TelegramLink) {
      await db().insert(schema.telegramLinks)
        .values({ userId: link.userId, telegramUserId: link.telegramUserId, chatId: link.chatId })
        .onConflictDoUpdate({
          target: schema.telegramLinks.telegramUserId,
          set: { userId: link.userId, chatId: link.chatId },
        });
    },
  };
}

export function dbUserDirectory(): UserDirectory {
  return {
    async usersWithGoogleAccount() {
      const rows = await db().selectDistinct({ userId: schema.googleAccounts.userId }).from(schema.googleAccounts);
      return rows.map(r => r.userId).sort((a, b) => a - b);
    },
    async ownerUserId() {
      const [r] = await db().select({ owner: min(schema.googleAccounts.userId) }).from(schema.googleAccounts);
      return r?.owner ?? null;
    },
  };
}
```

- [ ] **Step 4: Write the DB contract test (gated on `DATABASE_URL`, matching the existing pattern)**

`tests/db/user-adapters.contract.test.ts`:
```ts
import { describe, it, expect } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("user-adapters (DB contract)", () => {
  it("upsert is idempotent on telegram_user_id and round-trips by both keys", async () => {
    const { dbTelegramLinkRepo } = await import("../../src/db/user-adapters.js");
    const repo = dbTelegramLinkRepo();
    const tg = 900000000 + Math.floor(Date.now() % 1000);
    // NOTE: requires an existing users row; contract runs against a seeded dev DB.
    await repo.upsert({ userId: 1, telegramUserId: tg, chatId: tg });
    await repo.upsert({ userId: 1, telegramUserId: tg, chatId: tg + 1 }); // update, not duplicate
    const byTg = await repo.getByTelegramUserId(tg);
    expect(byTg).toEqual({ userId: 1, chatId: tg + 1 });
  });
});
```
(This test is a no-op in CI/local without `DATABASE_URL`, exactly like `tests/db/adapters.contract.test.ts`. Its `Date.now()` usage is test-only and acceptable here.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass (contract test skipped without `DATABASE_URL`). `npx next build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/ src/db/user-adapters.ts tests/db/user-adapters.contract.test.ts
git commit -m "feat(db): telegram_links unique index + identity adapters"
```

---

### Task 3: Rewire the inbound path (worker + telegram routes)

**Files:**
- Modify: `app/api/worker/route.ts`
- Modify: `app/api/telegram/route.ts`

**Interfaces:**
- Consumes: `resolveUserForTelegram`, `isAuthorizedTelegram` (Task 1); `dbTelegramLinkRepo`, `dbUserDirectory` (Task 2).

- [ ] **Step 1: Rewire `app/api/telegram/route.ts`** (authorize via link-or-owner instead of owner-only)

Replace the file's body with (imports change: drop `isAllowed`, add `isAuthorizedTelegram` + `dbTelegramLinkRepo`):
```ts
// app/api/telegram/route.ts
import { env } from "../../../src/config/env.js";
import { enqueue } from "../../../src/queue/qstash.js";
import { isAuthorizedTelegram } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo } from "../../../src/db/user-adapters.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== e.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  const fromId = update?.message?.from?.id;
  if (typeof fromId !== "number" || !(await isAuthorizedTelegram(e.TELEGRAM_OWNER_ID, fromId, dbTelegramLinkRepo()))) {
    return Response.json({ ok: true, skipped: true });
  }
  await enqueue(e, "/api/worker", update);   // ack immediately; process async
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Rewire `app/api/worker/route.ts`** (resolve the acting user; drop `USER_ID = 1`)

Replace the file's body with:
```ts
// app/api/worker/route.ts
import { env } from "../../../src/config/env.js";
import { verifyQStash } from "../../../src/queue/qstash.js";
import { authedGmailFor } from "../../../src/oauth/google.js";
import { googleGmailClient } from "../../../src/gmail/client.js";
import { geminiProvider } from "../../../src/llm/gemini.js";
import { dbMemoryStore } from "../../../src/db/adapters.js";
import { dbConversationRepo } from "../../../src/db/conversation-adapter.js";
import { readOnlyTools } from "../../../src/agent/tools.js";
import { trashTools } from "../../../src/cleanup/tools.js";
import { dbProposalRepo, dbActionLogRepo } from "../../../src/db/cleanup-adapters.js";
import { handleMessage } from "../../../src/telegram/bot.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { resolveUserForTelegram } from "../../../src/users/identity.js";
import { dbTelegramLinkRepo, dbUserDirectory } from "../../../src/db/user-adapters.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const update = await verifyQStash(e, req) as any;
  const fromId = update?.message?.from?.id;
  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text;
  if (typeof fromId !== "number" || typeof text !== "string" || typeof chatId !== "number") {
    return Response.json({ ok: true, skipped: true });
  }
  const userId = await resolveUserForTelegram(e.TELEGRAM_OWNER_ID, fromId, chatId, dbTelegramLinkRepo(), dbUserDirectory());
  if (userId === null) return Response.json({ ok: true, skipped: true });
  const auth = await authedGmailFor(userId, e);
  const store = await dbMemoryStore(userId);
  const reply = await handleMessage(text, {
    userId, gmail: googleGmailClient(auth), memory: store,
    llm: geminiProvider(e.GEMINI_API_KEY), convo: dbConversationRepo(),
    proposals: dbProposalRepo(), actionLog: dbActionLogRepo(),
    tools: [...readOnlyTools(), ...trashTools()], timezone: e.OWNER_TZ,
  });
  await store.flush();
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  await sendFormatted(bot, chatId, reply);
  return Response.json({ ok: true });
}
```
Note: the reply still goes to the incoming `chatId` (unchanged). Authorization is now the resolver returning non-null (which also lazily records the owner's link).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass (no test imports these routes). `npx next build` → succeeds; the two routes still emit as dynamic.

- [ ] **Step 4: Commit**

```bash
git add app/api/worker/route.ts app/api/telegram/route.ts
git commit -m "feat(routes): resolve acting user from telegram_links (drop USER_ID=1)"
```

---

### Task 4: Poll fan-out over all users

**Files:**
- Create: `src/notifier/fanout.ts`
- Create: `tests/notifier/fanout.test.ts`
- Modify: `app/api/poll/route.ts`

**Interfaces:**
- Consumes: `TelegramLinkRepo`, `UserDirectory`, `ensureOwnerLink` (Task 1).
- Produces: `pollAllUsers(deps): Promise<{ polled: number; skipped: number; errored: number }>`.

- [ ] **Step 1: Write the failing test**

`tests/notifier/fanout.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pollAllUsers } from "../../src/notifier/fanout.js";
import { fakeTelegramLinkRepo, fakeUserDirectory } from "../../src/users/identity.js";

const OWNER = 555;

describe("pollAllUsers", () => {
  it("ensures the owner link, then polls each user at their chatId", async () => {
    const links = fakeTelegramLinkRepo([]);         // owner link will be bootstrapped
    const dir = fakeUserDirectory([1]);
    const calls: Array<{ userId: number; chatId: number }> = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir,
      pollUser: async (userId, chatId) => { calls.push({ userId, chatId }); } });
    expect(calls).toEqual([{ userId: 1, chatId: OWNER }]);
    expect(res).toEqual({ polled: 1, skipped: 0, errored: 0 });
  });
  it("skips a user with no telegram link", async () => {
    const links = fakeTelegramLinkRepo([{ userId: 1, telegramUserId: OWNER, chatId: OWNER }]);
    const dir = fakeUserDirectory([1, 2]);          // user 2 has a google account but no link
    const calls: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir,
      pollUser: async (userId) => { calls.push(userId); } });
    expect(calls).toEqual([1]);
    expect(res).toEqual({ polled: 1, skipped: 1, errored: 0 });
  });
  it("isolates a per-user failure and continues", async () => {
    const links = fakeTelegramLinkRepo([
      { userId: 1, telegramUserId: OWNER, chatId: OWNER },
      { userId: 2, telegramUserId: 222, chatId: 222 },
    ]);
    const dir = fakeUserDirectory([1, 2]);
    const ok: number[] = [];
    const res = await pollAllUsers({ ownerTelegramId: OWNER, links, directory: dir,
      pollUser: async (userId) => { if (userId === 1) throw new Error("boom"); ok.push(userId); } });
    expect(ok).toEqual([2]);
    expect(res).toEqual({ polled: 1, skipped: 0, errored: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifier/fanout.test.ts`
Expected: FAIL — cannot resolve `../../src/notifier/fanout.js`.

- [ ] **Step 3: Implement `src/notifier/fanout.ts`**

```ts
// Fan the poll out over every user with a linked Google account.
import type { TelegramLinkRepo, UserDirectory } from "../users/identity.js";
import { ensureOwnerLink } from "../users/identity.js";

export interface FanoutDeps {
  ownerTelegramId: number;
  links: TelegramLinkRepo;
  directory: UserDirectory;
  pollUser: (userId: number, chatId: number) => Promise<void>;
}

export async function pollAllUsers(deps: FanoutDeps): Promise<{ polled: number; skipped: number; errored: number }> {
  await ensureOwnerLink(deps.ownerTelegramId, deps.links, deps.directory);
  const userIds = await deps.directory.usersWithGoogleAccount();
  let polled = 0, skipped = 0, errored = 0;
  for (const userId of userIds) {
    const link = await deps.links.getByUserId(userId);
    if (!link) { skipped++; continue; }             // no chat to deliver to
    try { await deps.pollUser(userId, link.chatId); polled++; }
    catch (e) { errored++; console.error(`poll failed for user ${userId}`, e); }
  }
  return { polled, skipped, errored };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notifier/fanout.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Rewire `app/api/poll/route.ts`** (fan-out; drop `USER_ID = 1`)

Replace the file's body with:
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
  const summary = await pollAllUsers({
    ownerTelegramId: e.TELEGRAM_OWNER_ID,
    links: dbTelegramLinkRepo(),
    directory: dbUserDirectory(),
    pollUser: async (userId, chatId) => {
      const auth = await authedGmailFor(userId, e);
      const gmail = googleGmailClient(auth);
      const res = await runPoll({ userId, gmail, store: await dbMemoryStore(userId), llm, sync: dbSyncRepo(), seen: dbSeenRepo() });
      if (res.firstRun) return;
      const ids = res.important.map(i => i.messageId);
      if (ids.length === 0) { await res.commit(); return; }
      let brief = await generateBrief(ids, { gmail, llm, timezone: e.OWNER_TZ });
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
The per-user body is the exact previous single-user logic; only the target `chatId` (was `e.TELEGRAM_OWNER_ID`) now comes from the user's link, and the whole thing runs once per user via `pollAllUsers`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → all pass. `npx next build` → succeeds; `/api/poll` still emits as dynamic.

- [ ] **Step 7: Commit**

```bash
git add src/notifier/fanout.ts tests/notifier/fanout.test.ts app/api/poll/route.ts
git commit -m "feat(poll): fan out over all users, deliver to per-user chat"
```

---

## Self-Review

**Spec coverage (Stage B slice, spec §5):**
- Resolve identity via `telegram_links` (kill `USER_ID = 1`) → Task 1 (`resolveUserForTelegram`) + Task 3 (worker) + Task 4 (poll). ✓
- Owner bootstrap + backfill (first message upserts link; poll ensures link) → `resolveUserForTelegram` owner branch + `ensureOwnerLink`. ✓
- Allowlist = "linked OR owner" → `isAuthorizedTelegram` (Task 3, telegram route). ✓
- Poll fan-out over users with a Google account; deliver to their `chat_id` → Task 4. ✓
- Fix `memory/store.ts` hardcode → Task 1 Step 5 (fake `userId` param; the DB adapter was already correct). ✓
- Race-safe lazy link upserts → Task 2 unique index. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. The only generated artifact (the migration SQL) has its exact expected content named in Task 2 Step 2. ✓

**Type consistency:** `TelegramLinkRepo`/`UserDirectory` method names and signatures are identical across Task 1 (definition + fakes), Task 2 (DB adapters), and Tasks 3–4 (consumers). `pollAllUsers`'s `FanoutDeps` shape matches its test and the poll route's call site. `resolveUserForTelegram(ownerTelegramId, telegramUserId, chatId, links, directory)` argument order is identical in Task 1, its test, and Task 3. ✓

## Execution Handoff

After all four tasks pass, run a whole-branch adversarial review (behavior-preservation for the owner is the key risk), then merge to `main` via `superpowers:finishing-a-development-branch` (production deploy → deploy ping). Stage C (settings + digest window + token refresh) branches off the merged `main`.
