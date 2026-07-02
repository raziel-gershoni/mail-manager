# Next.js migration + Telegram Mini App + multi-user plumbing — design

Date: 2026-07-02
Status: Approved (interactive design review completed in-conversation)
Supersedes nothing; extends the deployed system described in
`2026-06-30-conversational-gmail-secretary-design.md`.

## 1. Overview

The mail-manager is a deployed, single-user conversational Gmail secretary on Telegram
(bare Vercel functions + Neon/Drizzle + Upstash QStash + Gemini). This project:

1. Migrates the bare Vercel functions to **Next.js (App Router)** for first-class Vercel
   compatibility and to eliminate the runtime friction we hit (invalid `functions.runtime`,
   relative `req.url`, ignored `export default`, per-function `vercel-build` multiplication).
2. Adds a **Telegram Mini App** settings surface (timezone, digest-hours window,
   pause/resume, Gmail connection + reconnect, read-only view of learned rules).
3. **Hardens token handling** (persist rotated refresh tokens, detect revocation and prompt
   re-consent, add OAuth `state` CSRF verification, make OAuth user-aware).
4. **Wires up multi-user plumbing** the schema already anticipates — resolve identity from
   `telegram_links` instead of a hardcoded `USER_ID = 1`, per-user settings, poll fan-out.
5. Re-introduces the **Telegram deploy notification**, now viable because Next.js builds once.

The DB is already multi-tenant-shaped (every table has a `user_id` FK). This is
**plumbing, not a schema rewrite** — no self-serve onboarding, no billing, no Google app
verification work. New users remain owner-curated (rows added out-of-band).

## 2. Non-goals (YAGNI)

- No self-serve signup / public OAuth. New users are curated by the owner.
- No per-user poll cadence (the single global 30-min QStash cron stays).
- No editing/deleting learned rules from the mini app — **view-only** in this round.
- No danger-zone (disconnect Gmail / delete-my-data) UI in this round.
- No Gmail push (Pub/Sub `watch`); polling via `history.list` stays.
- No change to the agent toolset, the trash rail, or the classification model.

## 3. Staging

Four independently deployable stages, each keeping the app green and its own implementation
plan. Sequenced to de-risk incrementally.

- **Stage A — Next.js migration.** Behavior-identical relocation + deploy ping. Prove prod
  still works before adding features.
- **Stage B — Multi-user plumbing.** Remove `USER_ID = 1`, resolve identity via
  `telegram_links`, per-user poll fan-out, fix `memory/store.ts` hardcode.
- **Stage C — Settings + digest window + token-refresh hardening.** New tables, quiet-hours
  skip-entirely semantics, rotation persistence, re-consent, `state` CSRF.
- **Stage D — Telegram Mini App.** Settings UI, initData auth, reconnect flow, view rules.

All `src/**` domain logic stays framework-agnostic and unit-tested with the existing fakes.
TDD throughout; `next build` (which runs the typecheck) + full vitest suite are the gates.

## 4. Stage A — Next.js migration

### 4.1 Structure
- Next.js 15, App Router. Each `api/<x>.ts` → `app/api/<x>/route.ts`, handlers **unchanged**
  (already `export async function GET|POST(req: Request): Promise<Response>`):
  - `poll` (POST), `worker` (POST), `telegram` (POST), `setup` (POST)
  - `oauth/start` (GET), `oauth/callback` (GET)
- Same URL paths → **no re-provisioning**: the QStash schedule still hits `/api/poll`, the
  Telegram webhook still hits `/api/telegram`, enqueue still targets `/api/worker`.
- Per route: `export const maxDuration = 60;` and `export const dynamic = "force-dynamic";`.
- Delete the `vercel.json` `functions` block — Next owns routing. This also removes the
  per-function `vercel-build` multiplication (the old 6× problem).
- Add `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom` deps.

### 4.2 tsconfig / module resolution (the main risk)
- Switch to Next's happy path: `module: "esnext"`, `moduleResolution: "bundler"`, add
  `jsx: "preserve"`, DOM libs, `allowJs`, `incremental`, the Next plugin; **keep `strict` and
  `noUncheckedIndexedAccess`**.
- **Keep the explicit `.js` import extensions** — `bundler` resolution tolerates `./foo.js`
  resolving to `foo.ts`, same as NodeNext. Vitest runs on Vite/esbuild and resolves `.js`→`.ts`
  regardless, so tests are unaffected by the resolution change.
- **First task is a spike**: flip the tsconfig, confirm `src/**` + all 42 test files typecheck
  and the full vitest suite is green, *before* moving any route. If `bundler` proves
  problematic, fall back to keeping NodeNext and configuring Next's webpack `extensionAlias`.

### 4.3 Build
- `vercel-build: "drizzle-kit migrate && next build && node scripts/notify-deploy.mjs"`.
  Migrations still auto-apply; `next build` runs once and does the typecheck.

### 4.4 Deploy notification (re-introduced)
- `scripts/notify-deploy.mjs`: sends one Telegram message to `TELEGRAM_OWNER_ID` on deploy.
- **Fires exactly once** because Next builds once (root cause of the old 6× spam is gone).
- **Production-only**: no-op unless `VERCEL_ENV === "production"` (avoid preview spam).
- **Never breaks the build**: fire-and-forget with a short (~5s) fetch timeout; any
  error/timeout is swallowed and exits 0 (the earlier build-stall concern).
- Message includes short commit SHA (`VERCEL_GIT_COMMIT_SHA`) + env.
- Caveat accepted: build-success is slightly before promotion; close enough.

## 5. Stage B — Multi-user plumbing

- **`resolveUserByTelegramId(telegramUserId)`** — looks up `telegram_links.telegram_user_id`
  → `user_id`. New module + DB adapter, unit-tested against a fake repo.
- **Owner bootstrap + backfill**: `TELEGRAM_OWNER_ID` remains the bootstrap owner. On the
  first authorized message we upsert `telegram_links(user_id, telegram_user_id, chat_id)` —
  we need `chat_id` persisted anyway so the poll can send to it (not to the env var).
- **Allowlist** becomes "is this Telegram id linked to a user?" (∪ the bootstrap owner id).
  Still owner-curated; no self-serve.
- **Poll fan-out**: `/api/poll` iterates every user that has a linked `google_account`
  instead of `USER_ID = 1`. With one user today the loop is effectively `[ownerUser]`.
- **Send target**: briefs go to the user's stored `chat_id` (from `telegram_links`), not
  `TELEGRAM_OWNER_ID`.
- Fix `src/memory/store.ts` hardcoded `userId: 1`; thread `userId` through every place it is
  currently a constant (`api/poll.ts`, `api/worker.ts`).
- `worker` resolves the sending user via `resolveUserByTelegramId` and passes that `userId`
  into `handleMessage` (instead of the constant).

## 6. Stage C — Settings, digest window, token-refresh hardening

### 6.1 Schema — migration `0003`
- **`user_settings`**: `user_id` PK (FK users), `timezone` text, `digest_start_hour` int,
  `digest_end_hour` int, `paused` boolean default false, `updated_at` timestamp.
  - Backfill user 1 from `OWNER_TZ` (or `UTC`) + defaults `08–22`, not paused.
  - When a user has no row, defaults apply (tz from `OWNER_TZ`, `08–22`, not paused).
  - `OWNER_TZ` becomes the fallback default rather than the source of truth.
- **`oauth_states`**: `state` text PK, `user_id` int (FK users), `created_at` timestamp.
  Short-lived; used for CSRF verification + binding a consent flow to a user. Expired/used
  rows are deleted on verify.

*(No `pending_digest` table — see §6.2.)*

### 6.2 Digest window semantics (skip-entirely)
- Per poll, **per user**: compute `now` in the user's timezone. If the user is `paused` OR
  `now` is outside the digest window → **skip the user entirely**: no Gmail calls, no
  classification, no DB writes, cursor frozen.
- Otherwise run the normal poll from wherever the cursor sits. Because the Gmail `historyId`
  cursor is cumulative, the first in-window poll after a quiet stretch naturally returns the
  whole accumulated batch and produces one "while you were away" brief. `seen_messages`
  dedupe is the backstop.
- Window supports overnight wrap (e.g. `22–07`). Hour granularity for v1.
- **Rationale** (chosen over held-queue and cursor-hold): zero Gmail/LLM cost for a user
  outside their hours, no extra table, no drain logic — just a guard at the top of the
  per-user loop. Classification is paid once, in the morning batch, for the whole set.
- **`history.list` 404 hardening** (needed because skipping makes a stale cursor more
  reachable, and it's correct regardless): on a 404 from history sync, reset the cursor to
  the current head historyId and treat as `firstRun` (can't enumerate the gap; send nothing
  that poll). This already-existing risk (cron down > ~1 week) is now handled explicitly.
- **Large morning batch**: parallelize per-message classification (independent calls) so the
  first in-window poll stays within `maxDuration: 60`. A per-poll processing cap is noted as a
  follow-up if batches ever get pathological.

### 6.3 Token-refresh hardening
- **Persist rotation**: attach `client.on("tokens", …)` in `authedGmailFor` (or a wrapper);
  when Google returns a new `refresh_token`, re-encrypt and update `google_accounts`.
  (Today the rotated token is silently dropped → eventual breakage.)
- **Detect revocation**: catch `invalid_grant` on Gmail calls → mark the account
  `needs_reconnect` (add a `needs_reconnect` boolean, default false, to
  `google_accounts` via `0003`), send a Telegram nudge, and surface it in the mini app.
- **CSRF**: persist the generated `state` in `oauth_states` bound to a `user_id`; verify on
  `/api/oauth/callback` (currently generated but never checked). Makes OAuth **user-aware** —
  the callback stores the token against the `state`'s `user_id`, which multi-user needs.
- **Reconnect** (mini app, Stage D): initData-authenticated request → server mints a
  user-bound OAuth URL (state → user_id in `oauth_states`) → Google consent → callback
  verifies state → stores token for that `user_id`, clears `needs_reconnect`.

## 7. Stage D — Telegram Mini App

- A Next client page at **`/miniapp`**. Reads `window.Telegram.WebApp.initData`; sends it in a
  header (`X-Telegram-Init-Data`) on every settings API call.
- **initData verification** (server, pure module `src/telegram/initdata.ts`, unit-tested with
  fixtures): compute `secret = HMAC-SHA256("WebAppData", bot_token)`, verify the `hash` of the
  sorted `data_check_string`, validate `auth_date` freshness (reject if older than 15 minutes).
  Then resolve `telegram_user_id` → `user_id` via `resolveUserByTelegramId`; apply allowlist.
  Unlinked id → 401 "not authorized."
- **`/api/settings` routes** (all initData-gated):
  - `GET /api/settings` → `{ timezone, digestStartHour, digestEndHour, paused,
    gmail: { email, connected, needsReconnect }, rules: [...] }`.
  - `POST /api/settings` → update timezone / digest window / paused.
  - `POST /api/settings/reconnect` → returns a user-bound Google OAuth URL to open.
- **UI**: timezone picker, digest window (start/end), pause toggle, Gmail status + Reconnect,
  read-only list of learned rules (`memories`: match value → verdict). Minimal styling using
  Telegram theme CSS variables; no component library.
- **Bot entry points**: set the chat menu button (`setChatMenuButton`) to open `/miniapp`, add
  a `/settings` command; wired into `ensureTelegramWebhook` / `/api/setup`.

## 8. Security invariants (unchanged, must be preserved)

- OAuth scope stays exactly `https://www.googleapis.com/auth/gmail.modify`.
- Trash-only; no permanent delete anywhere; undo + action_log intact.
- No new exfiltration surface: the mini app is settings + reconnect + read-only rules,
  entirely initData-HMAC-gated; the agent toolset is untouched.
- Secrets never logged; `TOKEN_ENC_KEY` never rotated.
- Owner-curated allowlist; agent still ignores instructions embedded in email content.
- New auth surfaces get their own tests: initData verification (with tampered/expired
  fixtures), `state` CSRF (mismatch rejected).

## 9. Testing strategy

- New **pure, framework-agnostic** modules, each unit-tested without Next:
  `initData` verify, digest-window predicate (incl. overnight wrap + tz), user resolver,
  token-rotation persist, history 404 → resync, deploy-notify message builder.
- Extend `notifier/poll.test.ts` for fan-out + skip-entirely **before** touching the handler.
- DB contract tests (gated on `DATABASE_URL`) extended for `user_settings` + `oauth_states`.
- `next build` typechecks the whole project; `vitest run` must stay green at every stage.

## 10. Risks & mitigations

1. **tsconfig/bundler resolution** — Stage-A spike-first gate; webpack `extensionAlias`
   fallback if needed.
2. **initData verification correctness** — dedicated fixtures incl. tampered hash + stale
   `auth_date`.
3. **Poll fan-out + windowing changing delivery** — expand `poll.test.ts` first.
4. **Deploy ping re-introduction** — production-gate + timeout + swallow-errors so it can
   never repeat the 6× spam or stall the build.
5. **Stale historyId 404** — explicit full-resync handling (§6.2).
