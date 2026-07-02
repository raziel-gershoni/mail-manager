# Stage A: Next.js Migration + Deploy Ping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the six bare Vercel serverless functions to Next.js App Router route handlers with behavior identical to today, and re-introduce a once-per-deploy Telegram notification.

**Architecture:** The handlers already use the App Router signature (`export async function GET|POST(req: Request): Promise<Response>`), so this is relocation + config, not a rewrite. `src/**` domain logic is untouched. TypeScript switches to Next's `bundler` module resolution while keeping the existing explicit `.js` import extensions. A build-time script sends one Telegram deploy ping (viable now because Next builds once, not once-per-function).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.6 (bundler resolution), Vitest, Drizzle, Vercel.

## Global Constraints

- Node `>=20`; project is ESM (`"type": "module"`).
- Keep explicit `.js` extensions on all relative TS imports.
- Same public URL paths — `/api/poll`, `/api/worker`, `/api/telegram`, `/api/setup`, `/api/oauth/start`, `/api/oauth/callback` — so **no QStash/webhook re-provisioning**.
- Preserve `strict` and `noUncheckedIndexedAccess` in tsconfig.
- OAuth scope stays exactly `https://www.googleapis.com/auth/gmail.modify` (Stage A does not touch OAuth logic).
- Deploy ping: **production-only** (`VERCEL_ENV === "production"`), ~5s fetch timeout, swallow all errors, always `exit 0` — it must never repeat the old 6× spam nor stall/fail the build.
- Secrets never logged.
- All 42 existing tests stay green; `next build` (which runs the typecheck) is a required gate at every task.
- **Never run `npm run vercel-build` locally** — it runs `drizzle-kit migrate` against the real Neon DB. Local verification uses `npx next build` directly (needs no env vars, since `env()` is only called inside handler bodies, never at import time).

---

### Task 1: Next.js scaffolding + module-resolution spike

This is the risk-gate. It proves the whole `src/**` + `tests/**` tree typechecks and the suite stays green under Next's `bundler` resolution **before** any route is moved.

**Files:**
- Modify: `package.json` (add deps + scripts)
- Modify: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: the Next.js build environment (`app/` dir, `next.config.mjs`) and a `bundler`-resolution `tsconfig.json` that later tasks rely on.

- [ ] **Step 1: Install Next.js + React**

```bash
npm install next@15 react@19 react-dom@19
npm install -D @types/react@19 @types/react-dom@19
```
Expected: installs succeed. If npm reports a peer-dependency conflict, re-run the failing install with the versions npm suggests and record them; do not use `--force`.

- [ ] **Step 2: Replace `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "dist"]
}
```
Note: `outDir` is removed (Next emits to `.next`). `include` now covers `src`, `api`, `tests`, `app`, and root `*.ts` — so `tsc --noEmit` still typechecks tests.

- [ ] **Step 3: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Resolve NodeNext-style ".js" import specifiers to the ".ts" source files.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create `app/layout.tsx`**

```tsx
import type { ReactNode } from "react";

export const metadata = { title: "Mail Manager" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Create `app/page.tsx`**

```tsx
export default function Home() {
  return <main>mail-manager is running.</main>;
}
```

- [ ] **Step 6: Update `.gitignore`**

Append:
```
# Next.js
.next/
next-env.d.ts
```

- [ ] **Step 7: Update `package.json` scripts**

Add `dev`, `build`, `start`; leave `vercel-build` unchanged for now (Task 3 rewires it). Resulting `scripts` block:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "vercel-build": "tsc --noEmit && drizzle-kit migrate"
}
```

- [ ] **Step 8: Verify typecheck (the resolution gate)**

Run: `npx tsc --noEmit`
Expected: PASS with no errors. If any `isolatedModules`-style "re-exporting a type" errors appear, fix each by converting the offending `export { X }` to `export type { X }` (only for type-only exports) — do not change runtime exports.

- [ ] **Step 9: Verify the full suite stays green**

Run: `npx vitest run`
Expected: all 42 test files pass (same as before the resolution change).

- [ ] **Step 10: Verify the Next shell builds**

Run: `npx next build`
Expected: build succeeds; output lists `/` as a static route. This generates `next-env.d.ts`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(next): scaffold Next.js App Router + switch to bundler resolution"
```

---

### Task 2: Relocate the six API routes to App Router

Pure relocation. Bodies are copied verbatim; only the import depth changes (each file moves 2 directories deeper, so every `../` prefix gains two levels) and the route-segment config is prepended.

**Files:**
- Create: `app/api/poll/route.ts`
- Create: `app/api/worker/route.ts`
- Create: `app/api/telegram/route.ts`
- Create: `app/api/setup/route.ts`
- Create: `app/api/oauth/start/route.ts`
- Create: `app/api/oauth/callback/route.ts`
- Delete: `api/poll.ts`, `api/worker.ts`, `api/telegram.ts`, `api/setup.ts`, `api/oauth/start.ts`, `api/oauth/callback.ts`

**Interfaces:**
- Consumes: all `src/**` modules (unchanged) via the deepened relative paths.
- Produces: the six live endpoints at their existing URL paths.

- [ ] **Step 1: Create `app/api/poll/route.ts`**

```ts
// app/api/poll/route.ts
import { env } from "../../../src/config/env.js";
import { verifyQStash } from "../../../src/queue/qstash.js";
import { authedGmailFor } from "../../../src/oauth/google.js";
import { googleGmailClient } from "../../../src/gmail/client.js";
import { geminiProvider } from "../../../src/llm/gemini.js";
import { dbMemoryStore, dbSeenRepo, dbSyncRepo } from "../../../src/db/adapters.js";
import { dbConversationRepo } from "../../../src/db/conversation-adapter.js";
import { runPoll } from "../../../src/notifier/poll.js";
import { generateBrief } from "../../../src/notifier/brief.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USER_ID = 1;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  await verifyQStash(e, req);
  const auth = await authedGmailFor(USER_ID, e);
  const gmail = googleGmailClient(auth);
  const llm = geminiProvider(e.GEMINI_API_KEY);
  const res = await runPoll({ userId: USER_ID, gmail, store: await dbMemoryStore(USER_ID), llm, sync: dbSyncRepo(), seen: dbSeenRepo() });
  if (res.firstRun) return Response.json({ ok: true, firstRun: true });
  const ids = res.important.map(i => i.messageId);
  if (ids.length === 0) {
    await res.commit();
    return Response.json({ ok: true, important: 0 });
  }
  let brief = await generateBrief(ids, { gmail, llm, timezone: e.OWNER_TZ });
  if (!brief || brief.trim() === "") {
    brief = `${ids.length} new important email(s):\n` +
      res.important.map(i => `• ${i.subject || "(no subject)"} — ${i.from}`).join("\n");
  }
  const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
  await sendFormatted(bot, e.TELEGRAM_OWNER_ID, brief);
  await dbConversationRepo().appendTurn(USER_ID, { role: "brief", content: brief });
  await res.commit();
  return Response.json({ ok: true, important: res.important.length });
}
```

- [ ] **Step 2: Create `app/api/worker/route.ts`**

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
import { handleMessage, isAllowed } from "../../../src/telegram/bot.js";
import { sendFormatted } from "../../../src/telegram/send.js";
import { Bot } from "grammy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USER_ID = 1;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const update = await verifyQStash(e, req) as any;
  const fromId = (update as any)?.message?.from?.id;
  if (!isAllowed(e.TELEGRAM_OWNER_ID, fromId)) return Response.json({ ok: true, skipped: true });
  const text = update?.message?.text;
  const chatId = update?.message?.chat?.id;
  if (typeof text !== "string" || !chatId) return Response.json({ ok: true, skipped: true });
  const auth = await authedGmailFor(USER_ID, e);
  const store = await dbMemoryStore(USER_ID);
  const reply = await handleMessage(text, {
    userId: USER_ID, gmail: googleGmailClient(auth), memory: store,
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

- [ ] **Step 3: Create `app/api/telegram/route.ts`**

```ts
// app/api/telegram/route.ts
import { env } from "../../../src/config/env.js";
import { enqueue } from "../../../src/queue/qstash.js";
import { isAllowed } from "../../../src/telegram/bot.js";

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
  if (!isAllowed(e.TELEGRAM_OWNER_ID, fromId)) {
    return Response.json({ ok: true, skipped: true });
  }
  await enqueue(e, "/api/worker", update);   // ack immediately; process async
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Create `app/api/setup/route.ts`**

```ts
// app/api/setup/route.ts
import { env } from "../../../src/config/env.js";
import { isSetupAuthorized } from "../../../src/setup/auth.js";
import { ensurePollSchedule } from "../../../src/queue/qstash.js";
import { ensureTelegramWebhook } from "../../../src/telegram/bot.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const e = env();
  const expected = e.SETUP_SECRET;
  if (!expected) return new Response("setup not configured", { status: 500 });
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null;
  if (!isSetupAuthorized(provided, expected)) return new Response("forbidden", { status: 403 });

  const out: { ok: boolean; schedule?: unknown; webhook?: unknown } = { ok: true };
  try {
    out.schedule = await ensurePollSchedule(e);
  } catch (err) {
    console.error("setup: schedule step failed", err);
    return Response.json({ ok: false, step: "schedule", error: (err as Error).message }, { status: 500 });
  }
  try {
    out.webhook = await ensureTelegramWebhook(e);
  } catch (err) {
    console.error("setup: webhook step failed", err);
    return Response.json({ ok: false, step: "webhook", error: (err as Error).message }, { status: 500 });
  }
  return Response.json(out);
}
```

- [ ] **Step 5: Create `app/api/oauth/start/route.ts`** (note the deeper `../../../../` prefix)

```ts
// app/api/oauth/start/route.ts — begins the Google OAuth consent flow (owner-guarded).
// Visit https://<app>/api/oauth/start?key=<SETUP_SECRET> in a browser once to connect Gmail.
import { randomBytes } from "node:crypto";
import { env } from "../../../../src/config/env.js";
import { buildAuthUrl } from "../../../../src/oauth/google.js";
import { isSetupAuthorized } from "../../../../src/setup/auth.js";
import { searchParam } from "../../../../src/http/url.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const e = env();
  const expected = e.SETUP_SECRET;
  if (!expected) return new Response("setup not configured (SETUP_SECRET unset)", { status: 500 });
  const key = searchParam(req.url, "key");
  if (!isSetupAuthorized(key, expected)) return new Response("forbidden", { status: 403 });
  const state = randomBytes(16).toString("hex");
  return new Response(null, { status: 302, headers: { Location: buildAuthUrl(e, state) } });
}
```

- [ ] **Step 6: Create `app/api/oauth/callback/route.ts`**

```ts
// app/api/oauth/callback/route.ts
import { env } from "../../../../src/config/env.js";
import { exchangeAndStore } from "../../../../src/oauth/google.js";
import { searchParam } from "../../../../src/http/url.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const code = searchParam(req.url, "code");
  if (!code) return new Response("missing code", { status: 400 });
  try {
    const { email } = await exchangeAndStore(env(), code);
    return new Response(`Connected ${email}. You can close this tab.`, { status: 200 });
  } catch (e) {
    console.error("oauth callback error", e);
    return new Response("OAuth failed — check the server logs.", { status: 500 });
  }
}
```

- [ ] **Step 7: Delete the old bare functions**

```bash
git rm api/poll.ts api/worker.ts api/telegram.ts api/setup.ts api/oauth/start.ts api/oauth/callback.ts
```
Expected: `api/` directory is now empty and removed by git.

- [ ] **Step 8: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Verify the suite**

Run: `npx vitest run`
Expected: all pass (no test imports `api/**`, so behavior is unchanged).

- [ ] **Step 10: Verify the full build with routes**

Run: `npx next build`
Expected: build succeeds; the six routes appear in the output as dynamic functions (`ƒ`), e.g. `/api/poll`, `/api/worker`, `/api/telegram`, `/api/setup`, `/api/oauth/start`, `/api/oauth/callback`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(next): relocate api handlers to app/api/**/route.ts"
```

---

### Task 3: Deploy notification + build wiring

**Files:**
- Create: `src/deploy/notify.ts`
- Create: `tests/deploy/notify.test.ts`
- Create: `scripts/notify-deploy.mjs`
- Delete: `vercel.json`
- Modify: `package.json` (`vercel-build`)

**Interfaces:**
- Produces: `shouldNotifyDeploy(vercelEnv: string | undefined): boolean` and `buildDeployMessage(sha: string | undefined): string` (pure, tested). `scripts/notify-deploy.mjs` mirrors this logic at runtime (kept in sync manually; the canonical, tested definition lives in `src/deploy/notify.ts`).

- [ ] **Step 1: Write the failing test**

`tests/deploy/notify.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { shouldNotifyDeploy, buildDeployMessage } from "../../src/deploy/notify.js";

describe("shouldNotifyDeploy", () => {
  it("is true only for production", () => {
    expect(shouldNotifyDeploy("production")).toBe(true);
    expect(shouldNotifyDeploy("preview")).toBe(false);
    expect(shouldNotifyDeploy("development")).toBe(false);
    expect(shouldNotifyDeploy(undefined)).toBe(false);
  });
});

describe("buildDeployMessage", () => {
  it("includes a short SHA when present", () => {
    expect(buildDeployMessage("abcdef1234567890")).toBe("🚀 mail-manager deployed (abcdef1).");
  });
  it("omits the SHA when absent", () => {
    expect(buildDeployMessage(undefined)).toBe("🚀 mail-manager deployed.");
    expect(buildDeployMessage("")).toBe("🚀 mail-manager deployed.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/deploy/notify.test.ts`
Expected: FAIL — cannot resolve `../../src/deploy/notify.js`.

- [ ] **Step 3: Write `src/deploy/notify.ts`**

```ts
// Pure helpers for the build-time deploy notification.
// scripts/notify-deploy.mjs mirrors this logic (it cannot import TS directly).
export function shouldNotifyDeploy(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}

export function buildDeployMessage(sha: string | undefined): string {
  const short = (sha ?? "").slice(0, 7);
  return `🚀 mail-manager deployed${short ? ` (${short})` : ""}.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/deploy/notify.test.ts`
Expected: PASS. Then run the full suite: `npx vitest run` → all pass.

- [ ] **Step 5: Create `scripts/notify-deploy.mjs`**

```js
// Sends ONE Telegram message to the owner on a successful production deploy.
// Runs at build time (Next builds once, so this fires once). Never fails the build.
// Canonical logic is tested in src/deploy/notify.ts; this mirrors it.
if (process.env.VERCEL_ENV !== "production") process.exit(0);

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_OWNER_ID;
if (!token || !chatId) process.exit(0);

const short = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
const text = `🚀 mail-manager deployed${short ? ` (${short})` : ""}.`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);
try {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: Number(chatId), text }),
    signal: controller.signal,
  });
} catch {
  // swallow — a failed or slow ping must never break the deploy
} finally {
  clearTimeout(timer);
}
process.exit(0);
```

- [ ] **Step 6: Delete `vercel.json`**

```bash
git rm vercel.json
```
Rationale: Next.js owns routing; per-route `maxDuration` is set via the segment config exports. Removing the `functions` block also eliminates the per-function `vercel-build` multiplication that caused the old 6× deploy-ping spam.

- [ ] **Step 7: Rewire `vercel-build` in `package.json`**

Change the `vercel-build` script to:
```json
"vercel-build": "drizzle-kit migrate && next build && node scripts/notify-deploy.mjs"
```
(`next build` runs the typecheck, so the standalone `tsc --noEmit` is no longer needed in the build chain.)

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit` → PASS.
Run: `npx vitest run` → all pass.
Run: `npx next build` → build succeeds.
Do **not** run `npm run vercel-build` locally (it would migrate the real DB).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(deploy): once-per-deploy Telegram ping + Next-owned build wiring"
```

---

## Self-Review

**Spec coverage (Stage A slice of the spec):**
- §4.1 route relocation, same paths, per-route `maxDuration`/`dynamic` → Task 2. ✓
- §4.1 delete `vercel.json` functions block → Task 3 Step 6. ✓
- §4.2 bundler resolution, keep `.js` extensions, spike-first → Task 1 (Steps 2, 8–10). ✓
- §4.3 build chain `drizzle-kit migrate && next build` (+ notify) → Task 3 Step 7. ✓
- §4.4 deploy ping: production-only, timeout, swallow, once → Task 3 (Steps 1–5). ✓
- Deps `next`/`react`/`react-dom`/`@types/react`(+dom) → Task 1 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content; the only judgement step (Task 1 Step 8's `export type` fix) names the exact transformation. ✓

**Type consistency:** `shouldNotifyDeploy`/`buildDeployMessage` signatures match between test (Task 3 Step 1), implementation (Step 3), and the mirrored script (Step 5). Route files reference only existing `src/**` exports (verified against current `api/*.ts` bodies). ✓

## Execution Handoff

After the three tasks pass, run a whole-branch adversarial review, then merge to `main` via `superpowers:finishing-a-development-branch` (production deploy → the deploy ping and the session ping both fire). Stages B/C/D get their own plans authored against the migrated tree.
