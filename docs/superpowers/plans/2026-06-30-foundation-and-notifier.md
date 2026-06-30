# Foundation + Important-Mail Notifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Telegram bot that, every ~30 minutes, classifies new Gmail inbox mail and sends the owner a digest of the **important** ones with one-tap `Not important` learning — non-destructive end to end.

**Architecture:** TypeScript on Vercel serverless functions. A QStash schedule pings `/api/poll`, which finds new inbox mail via the Gmail history cursor, classifies each message (deterministic sender/domain rules first, then a recall-biased Gemini call), records verdicts, and sends important ones to Telegram. Inline-button taps upsert sender rules into a Neon-backed memory store. Gmail, the LLM, and the queue all sit behind interfaces with fakes so the safety-relevant logic is unit-tested without live services.

**Tech Stack:** Node 20, TypeScript, Vitest, Drizzle ORM + `@neondatabase/serverless` (Neon Postgres), `grammy` (Telegram), `googleapis` + `google-auth-library` (Gmail/OAuth), `@google/genai` (Gemini 3.5 Flash), `@upstash/qstash`, Node built-in `crypto` (AES-256-GCM).

## Global Constraints

- **Node:** `>=20` (built-in `fetch`, `crypto.webcrypto`, ESM).
- **Module system:** ESM (`"type": "module"` in package.json); all local imports use explicit `.js` extensions in TS source per `NodeNext`.
- **Gmail scope:** `https://www.googleapis.com/auth/gmail.modify` only. Never request broader scopes.
- **Destructiveness:** This plan performs **no** Gmail mutations. The only Gmail calls allowed are `history.list`, `messages.list`, `messages.get` (read-only). No `trash`, no `batchModify`.
- **Refresh tokens** are encrypted at rest (AES-256-GCM) and never logged.
- **Telegram access** is restricted to the single allowlisted `TELEGRAM_OWNER_ID`; all other updates are dropped.
- **First-run guard:** on first poll for an account, set the cursor to the current `historyId` and notify on nothing (do not blast the existing inbox).
- **No live network in tests:** Gmail, LLM, and queue are injected interfaces; unit tests use fakes.
- **Env access** only through `src/config/env.ts` (validated once). No `process.env.X` scattered in modules.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, drizzle.config.ts, .env.example
src/
  config/env.ts            # validated env loader
  lib/crypto.ts            # AES-256-GCM encrypt/decrypt for refresh tokens
  db/schema.ts             # Drizzle tables
  db/client.ts             # Neon Drizzle client (lazy singleton)
  memory/store.ts          # MemoryStore: findRuleFor, index, upsertSenderRule, list
  gmail/headers.ts         # header parsing + EmailMeta construction (pure)
  gmail/risk.ts            # deterministic risk signals (pure)
  gmail/client.ts          # GmailClient interface + googleapis impl
  llm/provider.ts          # LLMProvider interface + types
  llm/gemini.ts            # Gemini 3.5 Flash impl
  notifier/classify.ts     # classifyEmail orchestration (rules -> LLM, recall-biased)
  notifier/digest.ts       # build Telegram digest text + inline buttons (pure)
  notifier/sync.ts         # SyncStateRepo + SeenMessagesRepo
  notifier/poll.ts         # runPoll orchestration
  oauth/google.ts          # auth URL + code->token exchange + token persistence
  queue/qstash.ts          # enqueue + verifySignature
  telegram/bot.ts          # grammy bot: allowlist, callbacks (ni/ai), /review, /rules
api/
  telegram.ts             # webhook: verify + ack + enqueue
  worker.ts               # QStash consumer (Telegram update processing)
  poll.ts                 # QStash schedule consumer (runPoll + send digest)
  oauth/callback.ts       # Google OAuth redirect handler
tests/                    # mirrors src/ with *.test.ts
```

---

### Task 1: Project scaffold + validated env config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`
- Create: `src/config/env.ts`
- Test: `tests/config/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source?: Record<string,string|undefined>): Env` where
  `Env = { DATABASE_URL: string; TOKEN_ENC_KEY: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_REDIRECT_URI: string; GEMINI_API_KEY: string; TELEGRAM_BOT_TOKEN: string; TELEGRAM_OWNER_ID: number; TELEGRAM_WEBHOOK_SECRET: string; QSTASH_TOKEN: string; QSTASH_CURRENT_SIGNING_KEY: string; QSTASH_NEXT_SIGNING_KEY: string; APP_BASE_URL: string }`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "mail-manager",
  "type": "module",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@google/genai": "^0.3.0",
    "@neondatabase/serverless": "^0.9.0",
    "@upstash/qstash": "^2.7.0",
    "drizzle-orm": "^0.33.0",
    "google-auth-library": "^9.0.0",
    "googleapis": "^144.0.0",
    "grammy": "^1.30.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.24.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.16.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src", "api", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts, .gitignore, .env.example**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"] } });
```
`.gitignore`:
```
node_modules
dist
.env
.vercel
```
`.env.example` (document every var; values blank):
```
DATABASE_URL=
TOKEN_ENC_KEY=            # 32-byte base64 key: `openssl rand -base64 32`
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=      # https://<app>/api/oauth/callback
GEMINI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_ID=        # your numeric Telegram user id
TELEGRAM_WEBHOOK_SECRET=  # random string; set on setWebhook
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
APP_BASE_URL=             # https://<app>
```

- [ ] **Step 4: Write the failing test**

```ts
// tests/config/env.test.ts
import { describe, it, expect } from "vitest";
import { loadEnv } from "../../src/config/env.js";

const valid = {
  DATABASE_URL: "postgres://x", TOKEN_ENC_KEY: "k", GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REDIRECT_URI: "https://a/cb", GEMINI_API_KEY: "g",
  TELEGRAM_BOT_TOKEN: "t", TELEGRAM_OWNER_ID: "123", TELEGRAM_WEBHOOK_SECRET: "w",
  QSTASH_TOKEN: "q", QSTASH_CURRENT_SIGNING_KEY: "c", QSTASH_NEXT_SIGNING_KEY: "n",
  APP_BASE_URL: "https://a",
};

describe("loadEnv", () => {
  it("parses a valid environment and coerces owner id to number", () => {
    const env = loadEnv(valid);
    expect(env.TELEGRAM_OWNER_ID).toBe(123);
    expect(env.DATABASE_URL).toBe("postgres://x");
  });
  it("throws listing the missing variable", () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/config/env.test.ts`
Expected: FAIL — cannot find module `src/config/env.js`.

- [ ] **Step 6: Implement env.ts**

```ts
// src/config/env.ts
export interface Env {
  DATABASE_URL: string; TOKEN_ENC_KEY: string;
  GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_REDIRECT_URI: string;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string; TELEGRAM_OWNER_ID: number; TELEGRAM_WEBHOOK_SECRET: string;
  QSTASH_TOKEN: string; QSTASH_CURRENT_SIGNING_KEY: string; QSTASH_NEXT_SIGNING_KEY: string;
  APP_BASE_URL: string;
}
const STRINGS = [
  "DATABASE_URL","TOKEN_ENC_KEY","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI",
  "GEMINI_API_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_WEBHOOK_SECRET","QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY","QSTASH_NEXT_SIGNING_KEY","APP_BASE_URL",
] as const;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing: string[] = [];
  const out: Record<string, unknown> = {};
  for (const key of STRINGS) {
    const v = source[key];
    if (!v) missing.push(key); else out[key] = v;
  }
  const owner = source.TELEGRAM_OWNER_ID;
  if (!owner) missing.push("TELEGRAM_OWNER_ID");
  else if (!/^\d+$/.test(owner)) throw new Error("TELEGRAM_OWNER_ID must be numeric");
  else out.TELEGRAM_OWNER_ID = Number(owner);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
  return out as Env;
}

let cached: Env | null = null;
export function env(): Env { return (cached ??= loadEnv()); }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/config/env.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore src/config/env.ts tests/config/env.test.ts
git commit -m "feat: scaffold project + validated env config"
```

---

### Task 2: Refresh-token encryption (AES-256-GCM)

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `tests/lib/crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plaintext: string, keyB64: string): string` and `decryptSecret(payload: string, keyB64: string): string`. Payload format: `base64(iv).base64(authTag).base64(ciphertext)` joined by `.`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/crypto.test.ts
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "../../src/lib/crypto.js";

const key = randomBytes(32).toString("base64");

describe("crypto round trip", () => {
  it("decrypts what it encrypts", () => {
    const enc = encryptSecret("refresh-token-123", key);
    expect(enc).not.toContain("refresh-token-123");
    expect(decryptSecret(enc, key)).toBe("refresh-token-123");
  });
  it("fails to decrypt with a different key", () => {
    const enc = encryptSecret("x", key);
    const other = randomBytes(32).toString("base64");
    expect(() => decryptSecret(enc, other)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement crypto.ts**

```ts
// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(keyB64: string): Buffer {
  const k = Buffer.from(keyB64, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes (base64)");
  return k;
}

export function encryptSecret(plaintext: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(payload: string, keyB64: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(keyB64), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/crypto.test.ts`
Expected: PASS (2 tests). The second passes because GCM auth-tag verification throws on a wrong key.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts tests/lib/crypto.test.ts
git commit -m "feat: AES-256-GCM secret encryption for refresh tokens"
```

---

### Task 3: Database schema + client + migrations

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces tables: `users`, `googleAccounts`, `telegramLinks`, `memories`, `seenMessages`, `syncState`. (`conversations`, `messages`, `proposals`, `actionLog` are added in Plan 2.)
- Produces: `db()` returning a Drizzle client bound to Neon.
- `memories` columns: `id`, `userId`, `slug` (unique per user), `description`, `body`, `scope` ('sender'|'domain'|'global'), `matchType` ('sender'|'domain'|null), `matchValue` (text|null), `verdict` ('important'|'unimportant'|null), `updatedAt`.

- [ ] **Step 1: Write the failing test (schema shape is importable & columns exist)**

```ts
// tests/db/schema.test.ts
import { describe, it, expect } from "vitest";
import * as schema from "../../src/db/schema.js";

describe("schema", () => {
  it("exposes the foundation tables", () => {
    for (const t of ["users","googleAccounts","telegramLinks","memories","seenMessages","syncState"]) {
      expect(schema, `missing table ${t}`).toHaveProperty(t);
    }
  });
  it("memories has rule fast-path columns", () => {
    const cols = Object.keys((schema.memories as any));
    for (const c of ["matchType","matchValue","verdict"]) expect(cols).toContain(c);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema.ts**

```ts
// src/db/schema.ts
import { pgTable, serial, integer, text, timestamp, boolean, bigint, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const googleAccounts = pgTable("google_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  encRefreshToken: text("enc_refresh_token").notNull(),
  scope: text("scope").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const telegramLinks = pgTable("telegram_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
});

export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  description: text("description").notNull(),
  body: text("body").notNull().default(""),
  scope: text("scope").notNull(), // 'sender' | 'domain' | 'global'
  matchType: text("match_type"),  // 'sender' | 'domain' | null
  matchValue: text("match_value"),
  verdict: text("verdict"),        // 'important' | 'unimportant' | null
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ slugUx: uniqueIndex("memories_user_slug_ux").on(t.userId, t.slug) }));

export const seenMessages = pgTable("seen_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  messageId: text("message_id").notNull(),
  surfaced: boolean("surfaced").notNull(),
  verdict: text("verdict").notNull(),    // 'important' | 'unimportant' | 'suspicious'
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ msgUx: uniqueIndex("seen_user_msg_ux").on(t.userId, t.messageId) }));

export const syncState = pgTable("sync_state", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  lastHistoryId: text("last_history_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 4: Implement client.ts + drizzle.config.ts**

```ts
// src/db/client.ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
export function db() {
  return (_db ??= drizzle(neon(env().DATABASE_URL), { schema }));
}
export { schema };
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 5: Run tests + generate migration**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: PASS (2 tests).
Then generate SQL: `npx drizzle-kit generate` (creates `drizzle/0000_*.sql`). Do not run `migrate` here (no DB in CI); migration is applied at deploy time.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/client.ts drizzle.config.ts drizzle/ tests/db/schema.test.ts
git commit -m "feat: Neon Drizzle schema, client, and initial migration"
```

---

### Task 4: MemoryStore (deterministic rules + index)

**Files:**
- Create: `src/memory/store.ts`
- Test: `tests/memory/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Verdict = "important" | "unimportant";
  interface RuleMatch { slug: string; verdict: Verdict; }
  interface MemoryIndexEntry { slug: string; description: string; scope: string; }
  interface MemoryRow { userId:number; slug:string; description:string; body:string;
    scope:string; matchType:string|null; matchValue:string|null; verdict:string|null; }
  interface MemoryStore {
    findRuleFor(fromEmail: string, fromDomain: string): RuleMatch | null;
    index(): MemoryIndexEntry[];
    list(): MemoryRow[];
    upsertSenderRule(fromEmail: string, verdict: Verdict): MemoryRow;
  }
  function inMemoryStore(seed?: MemoryRow[]): MemoryStore;   // pure, for tests + logic
  ```
- The DB-backed adapter is wired in Task 14/15; the pure `inMemoryStore` holds the matching logic so it is unit-tested in isolation. `findRuleFor` checks sender match first (exact `matchType==='sender'` and `matchValue===fromEmail`), then domain match.

- [ ] **Step 1: Write the failing test**

```ts
// tests/memory/store.test.ts
import { describe, it, expect } from "vitest";
import { inMemoryStore } from "../../src/memory/store.js";

describe("MemoryStore.findRuleFor", () => {
  it("returns null when no rule matches", () => {
    const s = inMemoryStore();
    expect(s.findRuleFor("a@x.com", "x.com")).toBeNull();
  });
  it("prefers an exact sender rule over a domain rule", () => {
    const s = inMemoryStore();
    s.upsertSenderRule("ceo@acme.com", "important");
    const dom = s.list(); // sanity
    expect(dom.length).toBe(1);
    expect(s.findRuleFor("ceo@acme.com", "acme.com")).toEqual({ slug: "sender:ceo@acme.com", verdict: "important" });
  });
  it("upsert updates verdict in place (no duplicate)", () => {
    const s = inMemoryStore();
    s.upsertSenderRule("n@linkedin.com", "unimportant");
    s.upsertSenderRule("n@linkedin.com", "important");
    expect(s.list().length).toBe(1);
    expect(s.findRuleFor("n@linkedin.com", "linkedin.com")?.verdict).toBe("important");
  });
  it("index returns only global/freeform memories for the LLM", () => {
    const s = inMemoryStore([
      { userId:1, slug:"global:newsletters", description:"weekly newsletters are noise",
        body:"", scope:"global", matchType:null, matchValue:null, verdict:null },
    ]);
    s.upsertSenderRule("n@linkedin.com", "unimportant");
    expect(s.index().map(e => e.slug)).toEqual(["global:newsletters"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement store.ts (pure in-memory adapter + types)**

```ts
// src/memory/store.ts
export type Verdict = "important" | "unimportant";
export interface RuleMatch { slug: string; verdict: Verdict; }
export interface MemoryIndexEntry { slug: string; description: string; scope: string; }
export interface MemoryRow {
  userId: number; slug: string; description: string; body: string;
  scope: string; matchType: string | null; matchValue: string | null; verdict: string | null;
}
export interface MemoryStore {
  findRuleFor(fromEmail: string, fromDomain: string): RuleMatch | null;
  index(): MemoryIndexEntry[];
  list(): MemoryRow[];
  upsertSenderRule(fromEmail: string, verdict: Verdict): MemoryRow;
}

export function inMemoryStore(seed: MemoryRow[] = []): MemoryStore {
  const rows: MemoryRow[] = [...seed];
  return {
    findRuleFor(fromEmail, fromDomain) {
      const sender = rows.find(r => r.matchType === "sender" && r.matchValue === fromEmail && r.verdict);
      const hit = sender ?? rows.find(r => r.matchType === "domain" && r.matchValue === fromDomain && r.verdict);
      return hit ? { slug: hit.slug, verdict: hit.verdict as Verdict } : null;
    },
    index() {
      return rows.filter(r => r.matchType === null).map(r => ({ slug: r.slug, description: r.description, scope: r.scope }));
    },
    list() { return [...rows]; },
    upsertSenderRule(fromEmail, verdict) {
      const slug = `sender:${fromEmail}`;
      let row = rows.find(r => r.slug === slug);
      if (!row) {
        row = { userId: 1, slug, description: `sender ${fromEmail} is ${verdict}`,
          body: "", scope: "sender", matchType: "sender", matchValue: fromEmail, verdict };
        rows.push(row);
      } else { row.verdict = verdict; row.description = `sender ${fromEmail} is ${verdict}`; }
      return row;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/memory/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/memory/store.ts tests/memory/store.test.ts
git commit -m "feat: MemoryStore rule matching + index (pure adapter)"
```

---

### Task 5: Email metadata parsing + deterministic risk signals

**Files:**
- Create: `src/gmail/headers.ts`, `src/gmail/risk.ts`
- Test: `tests/gmail/headers.test.ts`, `tests/gmail/risk.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface EmailMeta {
    id: string; threadId: string; from: string; fromEmail: string; fromDomain: string;
    subject: string; snippet: string; date: Date; headers: Record<string,string>;
  }
  function parseMessage(raw: GmailRawMessage): EmailMeta;   // GmailRawMessage defined in gmail/client.ts (Task 6) — re-declared minimally here
  interface RiskSignals { bulk: boolean; hasListUnsubscribe: boolean; transactional: boolean; }
  function riskSignals(email: EmailMeta): RiskSignals;
  ```
- To avoid a circular import, `headers.ts` defines and exports the minimal `GmailRawMessage` shape; `gmail/client.ts` imports it.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/gmail/headers.test.ts
import { describe, it, expect } from "vitest";
import { parseMessage } from "../../src/gmail/headers.js";

const raw = {
  id: "m1", threadId: "t1", snippet: "hi there",
  payload: { headers: [
    { name: "From", value: "Jane Doe <jane@Example.com>" },
    { name: "Subject", value: "Lunch?" },
    { name: "Date", value: "Tue, 30 Jun 2026 10:00:00 +0000" },
  ]},
};

describe("parseMessage", () => {
  it("extracts and lowercases the sender address + domain", () => {
    const m = parseMessage(raw);
    expect(m.fromEmail).toBe("jane@example.com");
    expect(m.fromDomain).toBe("example.com");
    expect(m.subject).toBe("Lunch?");
    expect(m.headers["from"]).toContain("jane");
  });
  it("falls back to empty subject and bare address forms", () => {
    const m = parseMessage({ id:"m2", threadId:"t2", snippet:"", payload:{ headers:[
      { name:"From", value:"bare@host.io" }]}});
    expect(m.fromEmail).toBe("bare@host.io");
    expect(m.subject).toBe("");
  });
});
```

```ts
// tests/gmail/risk.test.ts
import { describe, it, expect } from "vitest";
import { parseMessage } from "../../src/gmail/headers.js";
import { riskSignals } from "../../src/gmail/risk.js";

function withHeaders(hs: [string,string][]) {
  return parseMessage({ id:"x", threadId:"x", snippet:"", payload:{ headers:
    [["From","a@b.com"] as [string,string], ...hs].map(([name,value]) => ({ name, value })) }});
}

describe("riskSignals", () => {
  it("flags bulk mail with a List-Unsubscribe header", () => {
    const s = riskSignals(withHeaders([["List-Unsubscribe","<mailto:u@b.com>"]]));
    expect(s.bulk).toBe(true);
    expect(s.hasListUnsubscribe).toBe(true);
  });
  it("flags Precedence: bulk", () => {
    expect(riskSignals(withHeaders([["Precedence","bulk"]])).bulk).toBe(true);
  });
  it("flags transactional keywords in the subject", () => {
    const m = parseMessage({ id:"x",threadId:"x",snippet:"",payload:{headers:[
      {name:"From",value:"a@b.com"},{name:"Subject",value:"Your invoice #123 receipt"}]}});
    expect(riskSignals(m).transactional).toBe(true);
  });
  it("treats a plain personal mail as non-bulk, non-transactional", () => {
    const s = riskSignals(withHeaders([["Subject","coffee tomorrow"]]));
    expect(s).toEqual({ bulk:false, hasListUnsubscribe:false, transactional:false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/gmail/headers.test.ts tests/gmail/risk.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement headers.ts**

```ts
// src/gmail/headers.ts
export interface GmailHeader { name: string; value: string; }
export interface GmailRawMessage {
  id: string; threadId: string; snippet?: string;
  payload?: { headers?: GmailHeader[] };
}
export interface EmailMeta {
  id: string; threadId: string; from: string; fromEmail: string; fromDomain: string;
  subject: string; snippet: string; date: Date; headers: Record<string, string>;
}

function parseAddress(from: string): { email: string; domain: string } {
  const m = from.match(/<([^>]+)>/);
  const email = (m ? m[1] : from).trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1]! : "";
  return { email, domain };
}

export function parseMessage(raw: GmailRawMessage): EmailMeta {
  const headers: Record<string, string> = {};
  for (const h of raw.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  const from = headers["from"] ?? "";
  const { email, domain } = parseAddress(from);
  const dateStr = headers["date"];
  const date = dateStr ? new Date(dateStr) : new Date(0);
  return {
    id: raw.id, threadId: raw.threadId, from, fromEmail: email, fromDomain: domain,
    subject: headers["subject"] ?? "", snippet: raw.snippet ?? "",
    date: isNaN(date.getTime()) ? new Date(0) : date, headers,
  };
}
```

- [ ] **Step 4: Implement risk.ts**

```ts
// src/gmail/risk.ts
import type { EmailMeta } from "./headers.js";

export interface RiskSignals { bulk: boolean; hasListUnsubscribe: boolean; transactional: boolean; }

const TRANSACTIONAL = /\b(invoice|receipt|payment|order|refund|statement|verify|verification|password|security code|confirm)\b/i;

export function riskSignals(email: EmailMeta): RiskSignals {
  const h = email.headers;
  const hasListUnsubscribe = Boolean(h["list-unsubscribe"]);
  const precedence = (h["precedence"] ?? "").toLowerCase();
  const bulk = hasListUnsubscribe || precedence === "bulk" || precedence === "list" || precedence === "junk";
  const transactional = TRANSACTIONAL.test(email.subject) || TRANSACTIONAL.test(email.snippet);
  return { bulk, hasListUnsubscribe, transactional };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/gmail/headers.test.ts tests/gmail/risk.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/gmail/headers.ts src/gmail/risk.ts tests/gmail/headers.test.ts tests/gmail/risk.test.ts
git commit -m "feat: email metadata parsing + deterministic risk signals"
```

---

### Task 6: GmailClient interface + googleapis implementation + fake

**Files:**
- Create: `src/gmail/client.ts`
- Test: `tests/gmail/client.fake.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface GmailClient {
    currentHistoryId(): Promise<string>;
    listAddedMessageIds(startHistoryId: string): Promise<string[]>;  // INBOX messageAdded since cursor
    getMeta(id: string): Promise<EmailMeta>;
  }
  function googleGmailClient(auth: OAuth2Client): GmailClient;        // real impl
  function fakeGmailClient(opts: {...}): GmailClient;                 // for tests + poll tests
  ```
- Consumes: `EmailMeta`, `parseMessage`, `GmailRawMessage` from Task 5; `OAuth2Client` from `google-auth-library`.

- [ ] **Step 1: Write the failing test (against the fake, which encodes the contract)**

```ts
// tests/gmail/client.fake.test.ts
import { describe, it, expect } from "vitest";
import { fakeGmailClient } from "../../src/gmail/client.js";

describe("fakeGmailClient", () => {
  it("returns added ids since a history cursor and resolves metadata", async () => {
    const g = fakeGmailClient({
      historyId: "100",
      addedSince: { "90": ["a","b"] },
      messages: {
        a: { id:"a", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"x@y.com"}] } },
        b: { id:"b", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"z@y.com"}] } },
      },
    });
    expect(await g.currentHistoryId()).toBe("100");
    expect(await g.listAddedMessageIds("90")).toEqual(["a","b"]);
    expect((await g.getMeta("a")).fromEmail).toBe("x@y.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gmail/client.fake.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement client.ts (interface + fake + real impl)**

```ts
// src/gmail/client.ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { parseMessage, type EmailMeta, type GmailRawMessage } from "./headers.js";

export interface GmailClient {
  currentHistoryId(): Promise<string>;
  listAddedMessageIds(startHistoryId: string): Promise<string[]>;
  getMeta(id: string): Promise<EmailMeta>;
}

export function googleGmailClient(auth: OAuth2Client): GmailClient {
  const gmail = google.gmail({ version: "v1", auth });
  return {
    async currentHistoryId() {
      const res = await gmail.users.getProfile({ userId: "me" });
      return String(res.data.historyId);
    },
    async listAddedMessageIds(startHistoryId) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const res = await gmail.users.history.list({
          userId: "me", startHistoryId, historyTypes: ["messageAdded"],
          labelId: "INBOX", pageToken,
        });
        for (const h of res.data.history ?? [])
          for (const m of h.messagesAdded ?? [])
            if (m.message?.id) ids.push(m.message.id);
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return [...new Set(ids)];
    },
    async getMeta(id) {
      const res = await gmail.users.messages.get({
        userId: "me", id, format: "metadata",
        metadataHeaders: ["From","Subject","Date","List-Unsubscribe","Precedence"],
      });
      return parseMessage(res.data as GmailRawMessage);
    },
  };
}

export function fakeGmailClient(opts: {
  historyId: string;
  addedSince: Record<string, string[]>;
  messages: Record<string, GmailRawMessage>;
}): GmailClient {
  return {
    async currentHistoryId() { return opts.historyId; },
    async listAddedMessageIds(start) { return opts.addedSince[start] ?? []; },
    async getMeta(id) {
      const raw = opts.messages[id];
      if (!raw) throw new Error(`no fake message ${id}`);
      return parseMessage(raw);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/gmail/client.fake.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/gmail/client.ts tests/gmail/client.fake.test.ts
git commit -m "feat: GmailClient interface, googleapis impl, and fake"
```

---

### Task 7: LLMProvider interface + Gemini impl + fake

**Files:**
- Create: `src/llm/provider.ts`, `src/llm/gemini.ts`
- Test: `tests/llm/gemini.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ClassifyInput { email: EmailMeta; risk: RiskSignals; memoryIndex: MemoryIndexEntry[]; }
  interface ClassifyResult { important: boolean; suspicious: boolean; reason: string; }
  interface LLMProvider { classifyImportance(input: ClassifyInput): Promise<ClassifyResult>; }
  function fakeLLM(fn: (i: ClassifyInput) => ClassifyResult): LLMProvider;
  function geminiProvider(apiKey: string): LLMProvider;
  ```
- The Gemini impl uses `responseMimeType: "application/json"` with a strict 3-field schema, and is recall-biased by prompt. `gemini.test.ts` tests JSON-parsing/normalization via an injected fake `generate` fn (no live API).

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm/gemini.test.ts
import { describe, it, expect } from "vitest";
import { parseClassifyJson } from "../../src/llm/gemini.js";

describe("parseClassifyJson", () => {
  it("normalizes a well-formed response", () => {
    const r = parseClassifyJson('{"important":true,"suspicious":false,"reason":"from a person"}');
    expect(r).toEqual({ important:true, suspicious:false, reason:"from a person" });
  });
  it("recall-bias: defaults to important when the model omits the field", () => {
    const r = parseClassifyJson('{"reason":"unclear"}');
    expect(r.important).toBe(true);
    expect(r.suspicious).toBe(true);
  });
  it("throws on non-JSON so the caller can fall back to important", () => {
    expect(() => parseClassifyJson("not json")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm/gemini.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement provider.ts**

```ts
// src/llm/provider.ts
import type { EmailMeta } from "../gmail/headers.js";
import type { RiskSignals } from "../gmail/risk.js";
import type { MemoryIndexEntry } from "../memory/store.js";

export interface ClassifyInput { email: EmailMeta; risk: RiskSignals; memoryIndex: MemoryIndexEntry[]; }
export interface ClassifyResult { important: boolean; suspicious: boolean; reason: string; }
export interface LLMProvider { classifyImportance(input: ClassifyInput): Promise<ClassifyResult>; }

export function fakeLLM(fn: (i: ClassifyInput) => ClassifyResult): LLMProvider {
  return { async classifyImportance(i) { return fn(i); } };
}
```

- [ ] **Step 4: Implement gemini.ts**

```ts
// src/llm/gemini.ts
import { GoogleGenAI } from "@google/genai";
import type { ClassifyInput, ClassifyResult, LLMProvider } from "./provider.js";

const MODEL = "gemini-3.5-flash";

export function parseClassifyJson(text: string): ClassifyResult {
  const obj = JSON.parse(text) as Record<string, unknown>;
  // recall bias: missing/unknown important => treat as important+suspicious
  const importantGiven = typeof obj.important === "boolean";
  const important = importantGiven ? (obj.important as boolean) : true;
  const suspicious = typeof obj.suspicious === "boolean" ? (obj.suspicious as boolean) : !importantGiven;
  const reason = typeof obj.reason === "string" ? obj.reason : "";
  return { important, suspicious, reason };
}

function prompt(i: ClassifyInput): string {
  const rules = i.memoryIndex.map(m => `- ${m.description}`).join("\n") || "(none yet)";
  return [
    "You decide whether a new email deserves the user's attention NOW.",
    "Bias toward IMPORTANT when unsure (set suspicious=true for borderline cases).",
    "Bulk/marketing/notifications are usually NOT important; personal, transactional,",
    "financial, security, and human-reply emails usually ARE.",
    `Learned preferences:\n${rules}`,
    `Email:\nFrom: ${i.email.from}\nSubject: ${i.email.subject}\nSnippet: ${i.email.snippet}`,
    `Signals: bulk=${i.risk.bulk} transactional=${i.risk.transactional}`,
    'Reply ONLY as JSON: {"important":bool,"suspicious":bool,"reason":string}',
  ].join("\n\n");
}

export function geminiProvider(apiKey: string): LLMProvider {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async classifyImportance(input) {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt(input),
        config: { responseMimeType: "application/json", temperature: 0 },
      });
      return parseClassifyJson(res.text ?? "");
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/llm/gemini.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/llm/provider.ts src/llm/gemini.ts tests/llm/gemini.test.ts
git commit -m "feat: LLMProvider interface + Gemini 3.5 Flash classifier (recall-biased)"
```

---

### Task 8: classifyEmail orchestration (rules → LLM)

**Files:**
- Create: `src/notifier/classify.ts`
- Test: `tests/notifier/classify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ClassifyDeps { store: MemoryStore; llm: LLMProvider; }
  interface ClassifyOutcome { important: boolean; suspicious: boolean; reason: string; source: "rule"|"llm"; }
  function classifyEmail(email: EmailMeta, deps: ClassifyDeps): Promise<ClassifyOutcome>;
  ```
- Logic: a matching rule short-circuits (no LLM call, `source:"rule"`). Otherwise compute `riskSignals`, call `llm.classifyImportance`, and if the LLM call throws, fall back to `{ important:true, suspicious:true, reason:"llm-error-fallback", source:"llm" }` (fail toward surfacing).

- [ ] **Step 1: Write the failing test**

```ts
// tests/notifier/classify.test.ts
import { describe, it, expect } from "vitest";
import { classifyEmail } from "../../src/notifier/classify.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { parseMessage } from "../../src/gmail/headers.js";

const email = (from: string, subject = "") =>
  parseMessage({ id:"m", threadId:"t", snippet:"", payload:{ headers:[
    { name:"From", value: from }, { name:"Subject", value: subject }]}});

describe("classifyEmail", () => {
  it("short-circuits on a sender rule without calling the LLM", async () => {
    const store = inMemoryStore();
    store.upsertSenderRule("n@linkedin.com", "unimportant");
    const llm = fakeLLM(() => { throw new Error("should not be called"); });
    const r = await classifyEmail(email("n@linkedin.com"), { store, llm });
    expect(r).toMatchObject({ important:false, source:"rule" });
  });
  it("delegates to the LLM when no rule matches", async () => {
    const store = inMemoryStore();
    const llm = fakeLLM(() => ({ important:true, suspicious:false, reason:"human" }));
    const r = await classifyEmail(email("jane@x.com","Lunch?"), { store, llm });
    expect(r).toMatchObject({ important:true, source:"llm", reason:"human" });
  });
  it("falls back to important+suspicious when the LLM throws", async () => {
    const store = inMemoryStore();
    const llm = fakeLLM(() => { throw new Error("boom"); });
    const r = await classifyEmail(email("a@b.com"), { store, llm });
    expect(r).toMatchObject({ important:true, suspicious:true, source:"llm" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifier/classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement classify.ts**

```ts
// src/notifier/classify.ts
import type { EmailMeta } from "../gmail/headers.js";
import { riskSignals } from "../gmail/risk.js";
import type { MemoryStore } from "../memory/store.js";
import type { LLMProvider } from "../llm/provider.js";

export interface ClassifyDeps { store: MemoryStore; llm: LLMProvider; }
export interface ClassifyOutcome {
  important: boolean; suspicious: boolean; reason: string; source: "rule" | "llm";
}

export async function classifyEmail(email: EmailMeta, deps: ClassifyDeps): Promise<ClassifyOutcome> {
  const rule = deps.store.findRuleFor(email.fromEmail, email.fromDomain);
  if (rule) {
    return { important: rule.verdict === "important", suspicious: false, reason: `rule:${rule.slug}`, source: "rule" };
  }
  const risk = riskSignals(email);
  try {
    const r = await deps.llm.classifyImportance({ email, risk, memoryIndex: deps.store.index() });
    return { ...r, source: "llm" };
  } catch {
    return { important: true, suspicious: true, reason: "llm-error-fallback", source: "llm" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notifier/classify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifier/classify.ts tests/notifier/classify.test.ts
git commit -m "feat: classifyEmail orchestration (rule short-circuit + LLM fallback)"
```

---

### Task 9: Digest builder (pure)

**Files:**
- Create: `src/notifier/digest.ts`
- Test: `tests/notifier/digest.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface DigestItem { messageId: string; from: string; subject: string; reason: string; }
  interface TgButton { text: string; callbackData: string; }
  interface TgMessage { text: string; buttons: TgButton[][]; }   // grammy inline keyboard shape
  function buildImportantDigest(items: DigestItem[]): TgMessage | null;  // null when empty
  function buildReviewDigest(items: DigestItem[]): TgMessage | null;
  ```
- `Not important` button → `callbackData: "ni:<messageId>"`; `Actually important` → `"ai:<messageId>"`. Callback data must stay ≤64 bytes (Telegram limit) — Gmail message ids are short hex, well within budget.

- [ ] **Step 1: Write the failing test**

```ts
// tests/notifier/digest.test.ts
import { describe, it, expect } from "vitest";
import { buildImportantDigest, buildReviewDigest } from "../../src/notifier/digest.js";

const items = [
  { messageId:"a1", from:"Jane <jane@x.com>", subject:"Lunch?", reason:"from a person" },
  { messageId:"b2", from:"Stripe <no-reply@stripe.com>", subject:"Invoice", reason:"transactional" },
];

describe("buildImportantDigest", () => {
  it("returns null for an empty list", () => {
    expect(buildImportantDigest([])).toBeNull();
  });
  it("renders one row + a Not important button per item", () => {
    const msg = buildImportantDigest(items)!;
    expect(msg.text).toContain("Lunch?");
    expect(msg.text).toContain("Invoice");
    expect(msg.buttons).toHaveLength(2);
    expect(msg.buttons[0][0]).toEqual({ text: "🗑 Not important", callbackData: "ni:a1" });
    expect(msg.buttons[1][0].callbackData).toBe("ni:b2");
  });
});

describe("buildReviewDigest", () => {
  it("uses Actually important buttons", () => {
    const msg = buildReviewDigest([items[0]])!;
    expect(msg.buttons[0][0]).toEqual({ text: "⭐ Actually important", callbackData: "ai:a1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifier/digest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement digest.ts**

```ts
// src/notifier/digest.ts
export interface DigestItem { messageId: string; from: string; subject: string; reason: string; }
export interface TgButton { text: string; callbackData: string; }
export interface TgMessage { text: string; buttons: TgButton[][]; }

function row(it: DigestItem): string {
  const subj = it.subject || "(no subject)";
  return `• *${escapeMd(subj)}*\n  ${escapeMd(it.from)} — _${escapeMd(it.reason)}_`;
}
function escapeMd(s: string): string { return s.replace(/([*_`\[\]])/g, "\\$1"); }

export function buildImportantDigest(items: DigestItem[]): TgMessage | null {
  if (items.length === 0) return null;
  const text = `📬 *${items.length} new important* email(s):\n\n` + items.map(row).join("\n\n");
  const buttons = items.map(it => [{ text: "🗑 Not important", callbackData: `ni:${it.messageId}` }]);
  return { text, buttons };
}

export function buildReviewDigest(items: DigestItem[]): TgMessage | null {
  if (items.length === 0) return null;
  const text = `🔍 Recently *set aside* (the bot wasn't sure):\n\n` + items.map(row).join("\n\n");
  const buttons = items.map(it => [{ text: "⭐ Actually important", callbackData: `ai:${it.messageId}` }]);
  return { text, buttons };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notifier/digest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifier/digest.ts tests/notifier/digest.test.ts
git commit -m "feat: Telegram digest builder for important + review lists"
```

---

### Task 10: Sync-state + seen-messages repositories (with in-memory fakes)

**Files:**
- Create: `src/notifier/sync.ts`
- Test: `tests/notifier/sync.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SyncStateRepo { get(userId:number): Promise<string|null>; set(userId:number, historyId:string): Promise<void>; }
  interface SeenRow { messageId:string; surfaced:boolean; verdict:string; reason:string; }
  interface SeenRepo {
    has(userId:number, messageId:string): Promise<boolean>;
    record(userId:number, row:SeenRow): Promise<void>;
    recentSuspicious(userId:number, limit:number): Promise<SeenRow[]>;  // verdict==='suspicious' && !surfaced
    get(userId:number, messageId:string): Promise<SeenRow|null>;
  }
  function fakeSyncRepo(): SyncStateRepo;
  function fakeSeenRepo(): SeenRepo;
  ```
- The fakes hold the contract for Task 11's poll tests. DB-backed adapters (Drizzle) are added in Task 15 and must satisfy the same contract.

- [ ] **Step 1: Write the failing test**

```ts
// tests/notifier/sync.test.ts
import { describe, it, expect } from "vitest";
import { fakeSyncRepo, fakeSeenRepo } from "../../src/notifier/sync.js";

describe("fakeSyncRepo", () => {
  it("stores and returns the cursor", async () => {
    const s = fakeSyncRepo();
    expect(await s.get(1)).toBeNull();
    await s.set(1, "555");
    expect(await s.get(1)).toBe("555");
  });
});

describe("fakeSeenRepo", () => {
  it("dedupes and surfaces recent suspicious silenced items", async () => {
    const r = fakeSeenRepo();
    expect(await r.has(1, "a")).toBe(false);
    await r.record(1, { messageId:"a", surfaced:true, verdict:"important", reason:"" });
    await r.record(1, { messageId:"b", surfaced:false, verdict:"suspicious", reason:"borderline" });
    expect(await r.has(1, "a")).toBe(true);
    const sus = await r.recentSuspicious(1, 10);
    expect(sus.map(x => x.messageId)).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifier/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sync.ts (interfaces + fakes)**

```ts
// src/notifier/sync.ts
export interface SyncStateRepo {
  get(userId: number): Promise<string | null>;
  set(userId: number, historyId: string): Promise<void>;
}
export interface SeenRow { messageId: string; surfaced: boolean; verdict: string; reason: string; }
export interface SeenRepo {
  has(userId: number, messageId: string): Promise<boolean>;
  record(userId: number, row: SeenRow): Promise<void>;
  recentSuspicious(userId: number, limit: number): Promise<SeenRow[]>;
  get(userId: number, messageId: string): Promise<SeenRow | null>;
}

export function fakeSyncRepo(): SyncStateRepo {
  const m = new Map<number, string>();
  return {
    async get(u) { return m.get(u) ?? null; },
    async set(u, h) { m.set(u, h); },
  };
}

export function fakeSeenRepo(): SeenRepo {
  const m = new Map<string, SeenRow>();
  const k = (u: number, id: string) => `${u}:${id}`;
  const order: { u: number; id: string }[] = [];
  return {
    async has(u, id) { return m.has(k(u, id)); },
    async record(u, row) { if (!m.has(k(u, row.messageId))) order.push({ u, id: row.messageId }); m.set(k(u, row.messageId), row); },
    async recentSuspicious(u, limit) {
      return order.filter(o => o.u === u).map(o => m.get(k(o.u, o.id))!)
        .filter(r => r.verdict === "suspicious" && !r.surfaced).slice(-limit).reverse();
    },
    async get(u, id) { return m.get(k(u, id)) ?? null; },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notifier/sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifier/sync.ts tests/notifier/sync.test.ts
git commit -m "feat: sync-state + seen-messages repo interfaces with fakes"
```

---

### Task 11: runPoll orchestration

**Files:**
- Create: `src/notifier/poll.ts`
- Test: `tests/notifier/poll.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PollDeps { userId:number; gmail:GmailClient; store:MemoryStore; llm:LLMProvider;
    sync:SyncStateRepo; seen:SeenRepo; }
  interface PollResult { firstRun:boolean; important:DigestItem[]; processed:number; }
  function runPoll(deps: PollDeps): Promise<PollResult>;
  ```
- Logic:
  1. If `sync.get` is null → first-run guard: set cursor to `gmail.currentHistoryId()`, return `{firstRun:true, important:[], processed:0}` (notify nothing).
  2. Else: `ids = gmail.listAddedMessageIds(cursor)`; for each unseen id, `getMeta` → `classifyEmail` → `seen.record` (surfaced = important). Collect important into DigestItems.
  3. Advance cursor to `gmail.currentHistoryId()`. Return results.

- [ ] **Step 1: Write the failing test**

```ts
// tests/notifier/poll.test.ts
import { describe, it, expect } from "vitest";
import { runPoll } from "../../src/notifier/poll.js";
import { fakeGmailClient } from "../../src/gmail/client.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeLLM } from "../../src/llm/provider.js";
import { fakeSyncRepo, fakeSeenRepo } from "../../src/notifier/sync.js";

function deps(over: Partial<any> = {}) {
  return {
    userId: 1,
    gmail: fakeGmailClient({
      historyId: "200",
      addedSince: { "100": ["a","b"] },
      messages: {
        a: { id:"a", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"jane@x.com"},{name:"Subject",value:"Lunch"}] } },
        b: { id:"b", threadId:"t", snippet:"", payload:{ headers:[{name:"From",value:"n@linkedin.com"},{name:"Subject",value:"You appeared in searches"}] } },
      },
    }),
    store: inMemoryStore(),
    llm: fakeLLM(i => ({ important: i.email.fromEmail === "jane@x.com", suspicious:false, reason:"x" })),
    sync: fakeSyncRepo(),
    seen: fakeSeenRepo(),
    ...over,
  };
}

describe("runPoll", () => {
  it("first run sets the cursor and notifies nothing", async () => {
    const d = deps();
    const r = await runPoll(d);
    expect(r.firstRun).toBe(true);
    expect(r.important).toEqual([]);
    expect(await d.sync.get(1)).toBe("200");
  });
  it("second run classifies new mail and returns only important items", async () => {
    const d = deps();
    await d.sync.set(1, "100");
    const r = await runPoll(d);
    expect(r.processed).toBe(2);
    expect(r.important.map(i => i.messageId)).toEqual(["a"]);
    expect(await d.seen.has(1, "b")).toBe(true);   // recorded even though silenced
    expect(await d.sync.get(1)).toBe("200");        // cursor advanced
  });
  it("skips messages already seen", async () => {
    const d = deps();
    await d.sync.set(1, "100");
    await d.seen.record(1, { messageId:"a", surfaced:true, verdict:"important", reason:"" });
    const r = await runPoll(d);
    expect(r.processed).toBe(1);                     // only b processed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifier/poll.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement poll.ts**

```ts
// src/notifier/poll.ts
import type { GmailClient } from "../gmail/client.js";
import type { MemoryStore } from "../memory/store.js";
import type { LLMProvider } from "../llm/provider.js";
import type { SyncStateRepo, SeenRepo } from "./sync.js";
import type { DigestItem } from "./digest.js";
import { classifyEmail } from "./classify.js";

export interface PollDeps {
  userId: number; gmail: GmailClient; store: MemoryStore; llm: LLMProvider;
  sync: SyncStateRepo; seen: SeenRepo;
}
export interface PollResult { firstRun: boolean; important: DigestItem[]; processed: number; }

export async function runPoll(deps: PollDeps): Promise<PollResult> {
  const cursor = await deps.sync.get(deps.userId);
  if (cursor === null) {
    await deps.sync.set(deps.userId, await deps.gmail.currentHistoryId());
    return { firstRun: true, important: [], processed: 0 };
  }
  const ids = await deps.gmail.listAddedMessageIds(cursor);
  const important: DigestItem[] = [];
  let processed = 0;
  for (const id of ids) {
    if (await deps.seen.has(deps.userId, id)) continue;
    processed++;
    const email = await deps.gmail.getMeta(id);
    const outcome = await classifyEmail(email, { store: deps.store, llm: deps.llm });
    const verdict = outcome.important ? "important" : outcome.suspicious ? "suspicious" : "unimportant";
    await deps.seen.record(deps.userId, { messageId: id, surfaced: outcome.important, verdict, reason: outcome.reason });
    if (outcome.important) important.push({ messageId: id, from: email.from, subject: email.subject, reason: outcome.reason });
  }
  await deps.sync.set(deps.userId, await deps.gmail.currentHistoryId());
  return { firstRun: false, important, processed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notifier/poll.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notifier/poll.ts tests/notifier/poll.test.ts
git commit -m "feat: runPoll orchestration with first-run guard and dedupe"
```

---

### Task 12: Google OAuth (URL + token exchange + persistence)

**Files:**
- Create: `src/oauth/google.ts`, `api/oauth/callback.ts`
- Test: `tests/oauth/google.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function buildAuthUrl(env: Env, state: string): string;       // consent URL, offline + prompt=consent
  function oauthClient(env: Env): OAuth2Client;
  async function exchangeAndStore(env: Env, code: string): Promise<{ email:string }>;  // persists encrypted token
  async function authedGmailFor(userId: number, env: Env): Promise<OAuth2Client>;      // loads + decrypts token
  ```
- `buildAuthUrl` is pure-ish (string assembly) and unit-tested. The exchange/persistence functions touch Google + DB and are covered by the manual checklist in Task 15, not unit tests.

- [ ] **Step 1: Write the failing test**

```ts
// tests/oauth/google.test.ts
import { describe, it, expect } from "vitest";
import { buildAuthUrl } from "../../src/oauth/google.js";

const env: any = {
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec",
  GOOGLE_REDIRECT_URI: "https://app/api/oauth/callback",
};

describe("buildAuthUrl", () => {
  it("requests offline access, consent, and the gmail.modify scope", () => {
    const url = new URL(buildAuthUrl(env, "state123"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("client_id")).toBe("cid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/oauth/google.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement google.ts**

```ts
// src/oauth/google.ts
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { Env } from "../config/env.js";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export function oauthClient(env: Env): OAuth2Client {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function buildAuthUrl(env: Env, state: string): string {
  return oauthClient(env).generateAuthUrl({
    access_type: "offline", prompt: "consent", scope: [SCOPE], state,
  });
}

export async function exchangeAndStore(env: Env, code: string): Promise<{ email: string }> {
  const client = oauthClient(env);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("no refresh_token (re-consent with prompt=consent)");
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email!;
  // single-user bootstrap: ensure a user row id=1 exists, then store the account
  const enc = encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY);
  const [user] = await db().select().from(schema.users).limit(1);
  const userId = user?.id ?? (await db().insert(schema.users).values({}).returning())[0]!.id;
  const existing = await db().select().from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
  if (existing[0]) {
    await db().update(schema.googleAccounts).set({ encRefreshToken: enc, email, updatedAt: new Date() })
      .where(eq(schema.googleAccounts.id, existing[0].id));
  } else {
    await db().insert(schema.googleAccounts).values({ userId, email, encRefreshToken: enc, scope: SCOPE });
  }
  return { email };
}

export async function authedGmailFor(userId: number, env: Env): Promise<OAuth2Client> {
  const [acct] = await db().select().from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
  if (!acct) throw new Error("no google account linked");
  const client = oauthClient(env);
  client.setCredentials({ refresh_token: decryptSecret(acct.encRefreshToken, env.TOKEN_ENC_KEY) });
  return client;
}
```

- [ ] **Step 4: Implement api/oauth/callback.ts**

```ts
// api/oauth/callback.ts
import { env } from "../../src/config/env.js";
import { exchangeAndStore } from "../../src/oauth/google.js";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });
  try {
    const { email } = await exchangeAndStore(env(), code);
    return new Response(`Connected ${email}. You can close this tab.`, { status: 200 });
  } catch (e) {
    return new Response(`OAuth error: ${(e as Error).message}`, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/oauth/google.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/oauth/google.ts api/oauth/callback.ts tests/oauth/google.test.ts
git commit -m "feat: Google OAuth url, token exchange, encrypted persistence, callback"
```

---

### Task 13: QStash enqueue + signature verification

**Files:**
- Create: `src/queue/qstash.ts`
- Test: `tests/queue/qstash.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function enqueue(env: Env, path: "/api/worker", body: unknown): Promise<void>;  // publishes to APP_BASE_URL+path
  async function verifyQStash(env: Env, req: Request): Promise<unknown>;           // throws on bad signature, returns parsed body
  ```
- Uses `@upstash/qstash` `Client` (publish) and `Receiver` (verify). Unit test covers `enqueue` building the correct destination URL via an injected publish fn; signature verification is exercised by the manual checklist (needs real keys).

- [ ] **Step 1: Write the failing test**

```ts
// tests/queue/qstash.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildDestination } from "../../src/queue/qstash.js";

describe("buildDestination", () => {
  it("joins base url and path without double slashes", () => {
    expect(buildDestination("https://app.vercel.app/", "/api/worker")).toBe("https://app.vercel.app/api/worker");
    expect(buildDestination("https://app.vercel.app", "/api/worker")).toBe("https://app.vercel.app/api/worker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/queue/qstash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement qstash.ts**

```ts
// src/queue/qstash.ts
import { Client, Receiver } from "@upstash/qstash";
import type { Env } from "../config/env.js";

export function buildDestination(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "") + path;
}

export async function enqueue(env: Env, path: "/api/worker", body: unknown): Promise<void> {
  const client = new Client({ token: env.QSTASH_TOKEN });
  await client.publishJSON({ url: buildDestination(env.APP_BASE_URL, path), body });
}

export async function verifyQStash(env: Env, req: Request): Promise<unknown> {
  const signature = req.headers.get("upstash-signature") ?? "";
  const bodyText = await req.text();
  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });
  const valid = await receiver.verify({ signature, body: bodyText });
  if (!valid) throw new Error("invalid qstash signature");
  return bodyText ? JSON.parse(bodyText) : {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/queue/qstash.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/queue/qstash.ts tests/queue/qstash.test.ts
git commit -m "feat: QStash enqueue + signature verification"
```

---

### Task 14: Telegram bot — allowlist + callback/command handlers

**Files:**
- Create: `src/telegram/bot.ts`
- Test: `tests/telegram/handlers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function isAllowed(ownerId: number, fromId: number | undefined): boolean;
  interface HandlerDeps { store: MemoryStore; seen: SeenRepo; userId: number;
    gmailFromEmail(messageId: string): Promise<string>; }  // resolve sender email for a message id (for button taps)
  // pure handler logic, independent of grammy:
  function handleCallback(data: string, deps: HandlerDeps): Promise<{ reply: string }>;
  function buildBot(env: Env, deps: HandlerDeps): Bot;       // grammy wiring (thin)
  ```
- Callback contract: `ni:<id>` → resolve sender email → `store.upsertSenderRule(email,"unimportant")`, reply "Got it — muting <email>."; `ai:<id>` → `upsertSenderRule(email,"important")`, reply "Noted — <email> is important." Unknown prefixes reply "Unknown action."

- [ ] **Step 1: Write the failing test**

```ts
// tests/telegram/handlers.test.ts
import { describe, it, expect } from "vitest";
import { isAllowed, handleCallback } from "../../src/telegram/bot.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeSeenRepo } from "../../src/notifier/sync.js";

describe("isAllowed", () => {
  it("permits only the owner id", () => {
    expect(isAllowed(42, 42)).toBe(true);
    expect(isAllowed(42, 7)).toBe(false);
    expect(isAllowed(42, undefined)).toBe(false);
  });
});

describe("handleCallback", () => {
  const make = () => {
    const store = inMemoryStore();
    const deps = { store, seen: fakeSeenRepo(), userId: 1,
      gmailFromEmail: async (id: string) => (id === "a1" ? "n@linkedin.com" : "ceo@acme.com") };
    return { store, deps };
  };
  it("ni: mutes the sender as unimportant", async () => {
    const { store, deps } = make();
    const r = await handleCallback("ni:a1", deps);
    expect(r.reply).toMatch(/muting/i);
    expect(store.findRuleFor("n@linkedin.com","linkedin.com")?.verdict).toBe("unimportant");
  });
  it("ai: marks the sender important", async () => {
    const { store, deps } = make();
    await handleCallback("ai:b2", deps);
    expect(store.findRuleFor("ceo@acme.com","acme.com")?.verdict).toBe("important");
  });
  it("rejects unknown actions", async () => {
    const { deps } = make();
    expect((await handleCallback("zz:1", deps)).reply).toMatch(/unknown/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram/handlers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bot.ts**

```ts
// src/telegram/bot.ts
import { Bot, InlineKeyboard } from "grammy";
import type { Env } from "../config/env.js";
import type { MemoryStore } from "../memory/store.js";
import type { SeenRepo } from "../notifier/sync.js";
import { buildReviewDigest } from "../notifier/digest.js";

export function isAllowed(ownerId: number, fromId: number | undefined): boolean {
  return fromId !== undefined && fromId === ownerId;
}

export interface HandlerDeps {
  store: MemoryStore; seen: SeenRepo; userId: number;
  gmailFromEmail(messageId: string): Promise<string>;
}

export async function handleCallback(data: string, deps: HandlerDeps): Promise<{ reply: string }> {
  const [action, id] = data.split(":");
  if ((action === "ni" || action === "ai") && id) {
    const email = await deps.gmailFromEmail(id);
    if (action === "ni") { deps.store.upsertSenderRule(email, "unimportant"); return { reply: `Got it — muting ${email}.` }; }
    deps.store.upsertSenderRule(email, "important"); return { reply: `Noted — ${email} is important.` };
  }
  return { reply: "Unknown action." };
}

export function buildBot(env: Env, deps: HandlerDeps): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  bot.use(async (ctx, next) => { if (isAllowed(env.TELEGRAM_OWNER_ID, ctx.from?.id)) await next(); });

  bot.on("callback_query:data", async (ctx) => {
    const { reply } = await handleCallback(ctx.callbackQuery.data, deps);
    await ctx.answerCallbackQuery({ text: reply });
  });

  bot.command("rules", async (ctx) => {
    const rules = deps.store.list();
    const text = rules.length ? rules.map(r => `• ${r.description}`).join("\n") : "No rules learned yet.";
    await ctx.reply(text);
  });

  bot.command("review", async (ctx) => {
    const sus = await deps.seen.recentSuspicious(deps.userId, 10);
    const items = await Promise.all(sus.map(async s => ({
      messageId: s.messageId, from: await deps.gmailFromEmail(s.messageId), subject: "(set aside)", reason: s.reason,
    })));
    const msg = buildReviewDigest(items);
    if (!msg) { await ctx.reply("Nothing set aside recently."); return; }
    const kb = new InlineKeyboard();
    for (const row of msg.buttons) { for (const b of row) kb.text(b.text, b.callbackData); kb.row(); }
    await ctx.reply(msg.text, { reply_markup: kb, parse_mode: "Markdown" });
  });

  return bot;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram/handlers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/bot.ts tests/telegram/handlers.test.ts
git commit -m "feat: Telegram allowlist + callback/command handlers"
```

---

### Task 15: API wiring (webhook, worker, poll) + DB-backed adapters + deploy checklist

**Files:**
- Create: `api/telegram.ts`, `api/worker.ts`, `api/poll.ts`
- Create: `src/db/adapters.ts` (Drizzle-backed `MemoryStore`, `SeenRepo`, `SyncStateRepo` satisfying Task 4/10 interfaces)
- Create: `vercel.json`, `README.md` (setup + deploy + manual verification checklist)
- Test: `tests/db/adapters.contract.test.ts` (skipped unless `DATABASE_URL` is set)

**Interfaces:**
- Consumes everything above.
- Produces: `dbMemoryStore(userId)`, `dbSeenRepo()`, `dbSyncRepo()` returning the same interface types as the fakes (so `runPoll`/handlers are unchanged).

- [ ] **Step 1: Implement DB-backed adapters**

```ts
// src/db/adapters.ts
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { MemoryStore, RuleMatch, MemoryIndexEntry, MemoryRow, Verdict } from "../memory/store.js";
import type { SeenRepo, SeenRow, SyncStateRepo } from "../notifier/sync.js";

// NOTE: dbMemoryStore loads the user's rows once (call per run). Writes go straight to the DB.
export async function dbMemoryStore(userId: number): Promise<MemoryStore> {
  const rows = await db().select().from(schema.memories).where(eq(schema.memories.userId, userId));
  const local: MemoryRow[] = rows.map(r => ({ userId, slug:r.slug, description:r.description, body:r.body,
    scope:r.scope, matchType:r.matchType, matchValue:r.matchValue, verdict:r.verdict }));
  return {
    findRuleFor(email, domain): RuleMatch | null {
      const s = local.find(r => r.matchType === "sender" && r.matchValue === email && r.verdict);
      const hit = s ?? local.find(r => r.matchType === "domain" && r.matchValue === domain && r.verdict);
      return hit ? { slug: hit.slug, verdict: hit.verdict as Verdict } : null;
    },
    index(): MemoryIndexEntry[] {
      return local.filter(r => r.matchType === null).map(r => ({ slug:r.slug, description:r.description, scope:r.scope }));
    },
    list() { return [...local]; },
    upsertSenderRule(email, verdict): MemoryRow {
      const slug = `sender:${email}`;
      const description = `sender ${email} is ${verdict}`;
      const row: MemoryRow = { userId, slug, description, body:"", scope:"sender", matchType:"sender", matchValue:email, verdict };
      const idx = local.findIndex(r => r.slug === slug);
      if (idx >= 0) local[idx] = row; else local.push(row);
      // fire-and-forget upsert
      void db().insert(schema.memories).values({ userId, slug, description, body:"", scope:"sender",
        matchType:"sender", matchValue:email, verdict, updatedAt:new Date() })
        .onConflictDoUpdate({ target:[schema.memories.userId, schema.memories.slug],
          set:{ verdict, description, updatedAt:new Date() } });
      return row;
    },
  };
}

export function dbSeenRepo(): SeenRepo {
  return {
    async has(userId, messageId) {
      const r = await db().select().from(schema.seenMessages)
        .where(and(eq(schema.seenMessages.userId, userId), eq(schema.seenMessages.messageId, messageId))).limit(1);
      return r.length > 0;
    },
    async record(userId, row) {
      await db().insert(schema.seenMessages).values({ userId, messageId:row.messageId,
        surfaced:row.surfaced, verdict:row.verdict, reason:row.reason })
        .onConflictDoNothing({ target:[schema.seenMessages.userId, schema.seenMessages.messageId] });
    },
    async recentSuspicious(userId, limit) {
      const rows = await db().select().from(schema.seenMessages)
        .where(and(eq(schema.seenMessages.userId, userId), eq(schema.seenMessages.verdict, "suspicious"), eq(schema.seenMessages.surfaced, false)))
        .orderBy(desc(schema.seenMessages.createdAt)).limit(limit);
      return rows.map(r => ({ messageId:r.messageId, surfaced:r.surfaced, verdict:r.verdict, reason:r.reason }));
    },
    async get(userId, messageId) {
      const [r] = await db().select().from(schema.seenMessages)
        .where(and(eq(schema.seenMessages.userId, userId), eq(schema.seenMessages.messageId, messageId))).limit(1);
      return r ? { messageId:r.messageId, surfaced:r.surfaced, verdict:r.verdict, reason:r.reason } : null;
    },
  };
}

export function dbSyncRepo(): SyncStateRepo {
  return {
    async get(userId) {
      const [r] = await db().select().from(schema.syncState).where(eq(schema.syncState.userId, userId)).limit(1);
      return r?.lastHistoryId ?? null;
    },
    async set(userId, historyId) {
      await db().insert(schema.syncState).values({ userId, lastHistoryId:historyId })
        .onConflictDoUpdate({ target: schema.syncState.userId, set:{ lastHistoryId:historyId, updatedAt:new Date() } });
    },
  };
}
```

- [ ] **Step 2: Implement api/poll.ts (QStash schedule target)**

```ts
// api/poll.ts
import { env } from "../src/config/env.js";
import { verifyQStash } from "../src/queue/qstash.js";
import { authedGmailFor } from "../src/oauth/google.js";
import { googleGmailClient } from "../src/gmail/client.js";
import { geminiProvider } from "../src/llm/gemini.js";
import { dbMemoryStore, dbSeenRepo, dbSyncRepo } from "../src/db/adapters.js";
import { runPoll } from "../src/notifier/poll.js";
import { buildImportantDigest } from "../src/notifier/digest.js";
import { Bot, InlineKeyboard } from "grammy";

const USER_ID = 1; // single-user bootstrap

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  await verifyQStash(e, req);
  const auth = await authedGmailFor(USER_ID, e);
  const result = await runPoll({
    userId: USER_ID, gmail: googleGmailClient(auth),
    store: await dbMemoryStore(USER_ID), llm: geminiProvider(e.GEMINI_API_KEY),
    sync: dbSyncRepo(), seen: dbSeenRepo(),
  });
  const msg = buildImportantDigest(result.important);
  if (msg) {
    const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
    const kb = new InlineKeyboard();
    for (const r of msg.buttons) { for (const b of r) kb.text(b.text, b.callbackData); kb.row(); }
    await bot.api.sendMessage(e.TELEGRAM_OWNER_ID, msg.text, { reply_markup: kb, parse_mode: "Markdown" });
  }
  return Response.json({ ok: true, ...result, important: result.important.length });
}
```

- [ ] **Step 3: Implement api/telegram.ts (webhook: verify secret, ack fast, enqueue)**

```ts
// api/telegram.ts
import { env } from "../src/config/env.js";
import { enqueue } from "../src/queue/qstash.js";

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== e.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  await enqueue(e, "/api/worker", update);   // ack immediately; process async
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Implement api/worker.ts (process a Telegram update via grammy)**

```ts
// api/worker.ts
import { env } from "../src/config/env.js";
import { verifyQStash } from "../src/queue/qstash.js";
import { buildBot } from "../src/telegram/bot.js";
import { authedGmailFor } from "../src/oauth/google.js";
import { googleGmailClient } from "../src/gmail/client.js";
import { dbMemoryStore, dbSeenRepo } from "../src/db/adapters.js";

const USER_ID = 1;

export default async function handler(req: Request): Promise<Response> {
  const e = env();
  const update = await verifyQStash(e, req);
  const auth = await authedGmailFor(USER_ID, e);
  const gmail = googleGmailClient(auth);
  const bot = buildBot(e, {
    store: await dbMemoryStore(USER_ID), seen: dbSeenRepo(), userId: USER_ID,
    gmailFromEmail: async (id) => (await gmail.getMeta(id)).fromEmail,
  });
  await bot.init();
  await bot.handleUpdate(update as any);
  return Response.json({ ok: true });
}
```

- [ ] **Step 5: Create vercel.json + README setup/deploy/verification checklist**

`vercel.json`:
```json
{ "functions": { "api/**/*.ts": { "runtime": "@vercel/node@3" } } }
```

`README.md` must include this **manual verification checklist** (the end-to-end proof, since these paths need live services):

```
## One-time setup
1. Neon: create DB, set DATABASE_URL. Run `npm run db:generate && npm run db:migrate`.
2. Google Cloud: create OAuth client (Web), add redirect https://<app>/api/oauth/callback,
   enable Gmail API, add the gmail.modify scope, and PUBLISH the consent screen to
   "In production" (unverified is fine for one user) so the refresh token does not expire.
3. Generate TOKEN_ENC_KEY: `openssl rand -base64 32`.
4. Telegram: create a bot via @BotFather, get TELEGRAM_BOT_TOKEN; get your numeric id
   (TELEGRAM_OWNER_ID) from @userinfobot; pick a random TELEGRAM_WEBHOOK_SECRET.
5. Upstash: create QStash, copy QSTASH_TOKEN + both signing keys.
6. Set all env vars in Vercel and deploy.
7. Set the Telegram webhook:
   curl "https://api.telegram.org/bot<token>/setWebhook?url=https://<app>/api/telegram&secret_token=<secret>"
8. Create a QStash schedule (every 30 min) targeting https://<app>/api/poll.

## Verify
- [ ] Visit https://<app>/api/oauth/callback flow via the auth URL (log it from buildAuthUrl); see "Connected <email>".
- [ ] Manually trigger the QStash schedule once → first run sets the cursor, no Telegram message.
- [ ] Send yourself a new email → trigger the schedule → receive a digest with a Not important button.
- [ ] Tap Not important → bot replies "muting <sender>"; /rules now lists the sender.
- [ ] Send another email from that sender → trigger schedule → it is NOT surfaced (rule short-circuit).
- [ ] /review lists any set-aside suspicious mail with Actually important buttons.
- [ ] Send a Telegram message from a different account → bot ignores it (allowlist).
```

- [ ] **Step 6: Write the optional contract test (DB-gated)**

```ts
// tests/db/adapters.contract.test.ts
import { describe, it, expect } from "vitest";
const RUN = !!process.env.DATABASE_URL;
describe.skipIf(!RUN)("db adapters (integration)", () => {
  it("sync repo round-trips a cursor", async () => {
    const { dbSyncRepo } = await import("../../src/db/adapters.js");
    const repo = dbSyncRepo();
    await repo.set(1, "12345");
    expect(await repo.get(1)).toBe("12345");
  });
});
```

- [ ] **Step 7: Run full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all unit tests PASS; the integration test is skipped without `DATABASE_URL`; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add api/ src/db/adapters.ts vercel.json README.md tests/db/adapters.contract.test.ts
git commit -m "feat: API handlers, DB adapters, deploy + verification checklist"
```

---

## Self-Review

**Spec coverage check (against `2026-06-30-gmail-telegram-cleanup-bot-design.md`):**

- §5 Components — Telegram (T14/15), Vercel functions (T15), QStash (T13/15), Neon (T3), Gemini behind interface (T7), GmailClient (T6). ✓
- §7 Feature A flow — history cursor + first-run guard (T11), metadata fetch (T6), rule short-circuit + recall-biased LLM (T7/8), important digest + `Not important` (T9/15), learning via button (T14), `/review` of LLM-suspicion items (T10/14). ✓
- §9 Memory — store with index + rules (T4), DB adapter (T15). *Note:* full LLM-managed `write/edit/delete_memory` tools are exercised by Feature B (Plan 2); Plan 1 uses deterministic button-driven rule upserts, which the spec's "LLM manages memory" is relaxed to for crisp button signals. Documented here intentionally.
- §11 OAuth — `gmail.modify`, offline+consent, encrypted token, production-mode caveat in README (T12/15). ✓
- §12 Data model — users, google_accounts, telegram_links, memories, seen_messages, sync_state (T3). `conversations/messages/proposals/action_log` deferred to Plan 2 (cleanup), consistent with non-destructive scope. ✓
- §13 Security — allowlist (T14), webhook secret (T15), QStash signature (T13/15). ✓
- §14 Safety — Feature A is non-destructive by construction; no trash paths exist (Global Constraints enforce read-only Gmail). ✓
- §15 Hosting — webhook acks then enqueues (T15), QStash schedule for cadence (T15 checklist). ✓
- §16 Testing — interfaces + fakes, heaviest coverage on risk/classify/poll/rules. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. ✓

**Type consistency:** `EmailMeta`, `MemoryStore`/`RuleMatch`/`MemoryRow`/`Verdict`, `LLMProvider`/`ClassifyResult`, `SyncStateRepo`/`SeenRepo`/`SeenRow`, `DigestItem`/`TgMessage`, `runPoll`/`PollDeps` names are defined once and reused identically by fakes (T4/6/7/10) and DB adapters (T15). `upsertSenderRule` signature is identical across `inMemoryStore` and `dbMemoryStore`. ✓

**Deliberate spec relaxation (flagged for the reviewer):** memory mutations in Plan 1 are deterministic (button → `upsertSenderRule`) rather than LLM-driven; this keeps the notifier free of LLM-in-the-loop for corrections and fully unit-testable. Full LLM memory management arrives with the conversational engine in Plan 2.
```
