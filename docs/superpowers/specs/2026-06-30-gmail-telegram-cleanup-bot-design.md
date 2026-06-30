# Gmail Cleanup & Attention Bot — Design

- **Date:** 2026-06-30
- **Status:** Approved (design); pending implementation plan
- **Owner:** zhendos13@gmail.com

## 1. Summary

A Telegram bot connected to a single Gmail account that (A) proactively notifies you about **important** new mail and learns from your corrections, and (B) lets you **clean junk on demand** through natural conversation, trashing email by your instruction. An LLM does the classification and conversational reasoning; a persistent, LLM-managed memory store turns your feedback into durable rules. Hosted serverless on Vercel + Neon + Upstash.

## 2. Goals

- Surface new **important** inbox mail in Telegram, every ~30 min, with one-tap correction.
- Learn important/unimportant preferences over time as editable rules (no retraining).
- Let the user clear junk conversationally ("clean all LinkedIn junk" → summary → "nuke all").
- Make destructive actions **safe**: recoverable, capped, logged, undoable.
- Keep the LLM vendor swappable behind an interface.

## 3. Non-Goals (v1)

- Auto-cleanup / scheduled deletion (cleanup is always manually invoked).
- Permanent deletion (Trash only).
- Folders/labels other than `INBOX`.
- Multi-user onboarding UI or public availability (architecture is multi-user-ready; UX is not built).
- Web dashboard.
- Reading/processing full email bodies at scale (we work from metadata + headers + snippets).

## 4. Users & Scope

- **Single user** to start (the owner), but a real `users` table and per-user token storage from day one so growth doesn't require a rewrite.
- The bot is **allowlisted** to the owner's Telegram user ID; all other senders are ignored.

## 5. Architecture Overview

```
Telegram  ──webhook──▶  Vercel: /api/telegram   ──enqueue──▶  Upstash QStash
                              (verify+ack <1s)                      │
                                                                    ▼
QStash schedule (30m) ─▶ Vercel: /api/poll ─▶ QStash ─▶  Vercel: /api/worker
Google OAuth ─▶ Vercel: /api/oauth/callback                  (LLM + Gmail + DB)
                                                                    │
                          Neon Postgres ◀───────────────────────────┤
                          Gemini 3.5 Flash (LLMProvider) ◀───────────┤
                          Gmail API (GmailClient) ◀───────────────────┘
```

**Components**

- **Telegram bot** — the only user interface. Inline buttons for corrections/confirmations.
- **Vercel functions**
  - `/api/telegram` — webhook; verifies secret + allowlist, acks in <1s, enqueues a QStash job.
  - `/api/worker` — QStash consumer; runs the actual LLM/Gmail/DB work for a turn or a poll batch.
  - `/api/poll` — invoked by a QStash schedule; detects new mail and enqueues notify work.
  - `/api/oauth/callback` — Google OAuth redirect handler; stores encrypted refresh token.
- **Upstash QStash** — async queue (webhook→worker), schedules (30-min poll), and a per-user single-flight lock (one run at a time per account).
- **Neon Postgres** — all persistent state (see §12).
- **Gemini 3.5 Flash** behind an `LLMProvider` interface — post-paid billing; same Google trust boundary as Gmail.
- **Gmail API** behind a `GmailClient` interface — search, metadata fetch, trash/untrash.

## 6. Tech Stack & Hosting

- **Runtime:** Node/TypeScript on Vercel functions.
- **DB:** Neon Postgres (serverless driver).
- **Queue/Schedule/Lock:** Upstash QStash (+ Upstash Redis if a lightweight lock/dedupe cache is needed).
- **LLM:** Gemini 3.5 Flash (paid tier — no training on data), behind `LLMProvider`.
- **Why not Railway/Supabase:** evaluated; not needed. Vercel+QStash covers async without an always-on worker, Neon covers Postgres, Upstash covers queue/schedule. The interfaces keep us portable if that changes.

## 7. Feature A — Important-Mail Notifier (scheduled, non-destructive)

**Trigger:** QStash schedule every ~30 min → `/api/poll`.

**Flow**
1. Load `sync_state.last_history_id` for the account; call Gmail `history.list` (type `messageAdded`, label `INBOX`) to find new messages since the cursor. Fall back to `messages.list newer_than:` if history is unavailable. Update cursor.
2. **First-run guard:** on initial activation, set the cursor to "now" so the existing inbox is **not** blasted as new.
3. For each new message, fetch metadata (`format=metadata`: From, Subject, Date, key headers, snippet).
4. **Classify important vs not:**
   - **Memory rules short-circuit:** a confident rule (e.g. "LinkedIn notifications = unimportant") decides without an LLM call.
   - Otherwise one cheap Gemini call returns `{ important: bool, suspicious: bool, reason }`.
   - **Recall-biased:** when genuinely uncertain, classify **important** (surface it). Mark borderline-unimportant items `suspicious=true`.
5. **Notify:** send a digest of the **important** messages to Telegram — one line each (sender · subject · one-line reason) with a **`Not important`** inline button per item. Unimportant messages stay silent (no action).
6. **Learn:** tapping `Not important` writes/updates a memory and records the verdict on `seen_messages`.

**Closing the blind spot (LLM-suspicion driven):** the unimportant→important correction path surfaces only items the **LLM itself flagged `suspicious`** (low-confidence "probably not important"). A `/review` command lists recent suspicious-but-silenced mail with `Actually important` buttons; tapping feeds the reverse learning signal. Because the notifier never deletes, a missed-important email is still in the inbox — the only cost of a false negative is a missing ping, not lost mail.

## 8. Feature B — On-Demand Cleanup (conversational, destructive → Trash)

**Trigger:** a free-text Telegram message ("clean all LinkedIn junk", "cleanup", "leave only messages about invoices").

**Flow (hybrid: agentic core, deterministic safety rail)**
1. **Proposer (LLM):** interpret intent → build a Gmail search query → fetch candidate metadata → group and propose a trash set with reasons. Consults memory.
2. **Deterministic risk pass (no LLM):** tag each candidate using reliable signals — `List-Unsubscribe`/`Precedence: bulk` present (=genuinely bulk, safe) vs absent (suspicious), never-before-seen sender, user replied in thread, has attachment, transactional/financial keywords. These can **force** an item into the "flag for human" bucket regardless of LLM opinion.
3. **Risk-Reviewer (LLM, separate skeptical session):** precision-tuned **rescue** layer — pulls anything potentially valuable out of the trash pile and splits candidates into `auto-trash` vs `set-aside`. It may only be *more* cautious; it can never override a rule into trashing.
4. **Circuit breaker (deterministic):** per-run cap; if a run would touch too many unknown senders or any high-risk item, force a human check.
5. **Act:** trash the auto bucket via `batchModify` (+TRASH label), log every ID + run id to `action_log`.
6. **Digest + reply:** "Trashed 247 LinkedIn + 89 newsletters. Set aside 3: [Stripe invoice], [reply from a person], [ambiguous]. Reply to adjust or `undo`." User replies map to set-aside items / last action; durable preferences are written to memory.

**Hard rail:** the `trash` tool only executes against an ID set that has been surfaced and resolved through this pipeline — trashing arbitrary IDs the user never saw is structurally impossible.

## 9. Memory / Learning (shared)

Claude-Code-style memory the **LLM manages itself**:

- `memories` table: `slug`, `description`, `body`, `scope` (sender | domain | label | global), `updated_at`.
- Each run, the LLM receives the **index** of `(slug, description)`, fetches the bodies it deems relevant, and has `write_memory` / `edit_memory` / `delete_memory` tools.
- Both the notifier classifier, the Proposer, and the Risk-Reviewer read the same store, so corrections from either feature compound.
- Rules are **inspectable and editable** (a `/rules` command can list them), so learning never becomes an opaque black box.

## 10. LLM Provider Abstraction

- `LLMProvider` interface: `classify()`, `chat()` / `runTools()`, with a simple, strict-but-small tool/JSON schema (kept simple because Gemini's schema adherence is good-not-perfect).
- Default impl: **Gemini 3.5 Flash**. Swapping to Claude/GPT is a single-file change.
- **Roles** (prompts, not separate models): Proposer (recall), Risk-Reviewer (precision/skeptical), Classifier (recall-biased), Conversationalist.

## 11. Gmail Integration & OAuth

- **Scope:** `https://www.googleapis.com/auth/gmail.modify` (read + trash/untrash + label). This is a Google **restricted** scope.
- **OAuth caveat (important):** in OAuth **"Testing"** mode, refresh tokens **expire every 7 days**. Mitigation: publish the Cloud app to **"In production"** — **unverified is fine for a single owner** (click through Google's "unverified app" warning once); the refresh token then stops expiring. Document this as a required setup step.
- **Token storage:** refresh token **encrypted at rest** (libsodium/secretbox or KMS) with a key in Vercel env; never logged.
- **Operations used:** `messages.list` (search `q`), `messages.get` (`format=metadata`), `history.list`, `messages.batchModify` (+TRASH for trash, −TRASH for undo). No permanent delete.

## 12. Data Model (Neon)

- `users` — id, created_at.
- `google_accounts` — user_id, email, **encrypted_refresh_token**, scope, token_meta.
- `telegram_links` — user_id, telegram_user_id (the **allowlist**), chat_id.
- `conversations` — per chat, current state (e.g. awaiting-reply-to-proposal).
- `messages` — conversation turns (role, content, tool calls) for context.
- `proposals` — set-aside items from a cleanup run awaiting the user's reply (ids, summary, run_id).
- `action_log` — every trashed message id + run_id + timestamp (powers `undo`).
- `memories` — slug, description, body, scope, updated_at.
- `seen_messages` — message id, surfaced?, verdict (important/unimportant/suspicious), poll cursor (dedupe + learning).
- `sync_state` — per-account `last_history_id` / cursor.

## 13. Telegram Interface & Security

- **Allowlist:** only the configured Telegram user ID is served; everything else is dropped.
- **Webhook secret:** Telegram secret-token header verified on every call.
- **QStash signature** verified on `/api/worker` and `/api/poll`.
- **Commands:** free-text (cleanup + chat), `/review` (audit suspicious-silenced mail), `/rules` (list/edit memories), `/undo` (revert last cleanup run). Inline buttons: `Not important`, `Actually important`, plus cleanup confirmations.

## 14. Safety Model (priority order)

1. **Trash-only + 30-day recoverability** — primary net.
2. **`action_log` + `undo last run`** — explicit reversal.
3. **Deterministic risk rules** — reliable signals force human review.
4. **Circuit-breaker cap** — bounds blast radius per run.
5. **Allowlist + webhook/QStash signature verification + per-user single-flight lock.**
6. **Risk-Reviewer LLM** — rescue layer (acknowledged: correlated with Proposer, so *not* the primary guarantee).

The notifier (Feature A) is **non-destructive by construction** and sits outside this risk surface entirely.

## 15. Hosting Caveats & Risks

- **Webhook latency:** Telegram retries if not acked quickly → `/api/telegram` only verifies + enqueues (<1s); real work is async in `/api/worker`.
- **Vercel function timeout:** Hobby ~10s, Pro ~300s. At <1k inbox this is fine, but the worker is built to **re-enqueue itself in chunks** if a run ever runs long.
- **Vercel Cron on Hobby = once/day only** → we use **QStash schedules** for the 30-min poll cadence instead.
- **Cold starts:** negligible for a single user.
- **Gemini schema adherence:** good but not perfect → keep tool/JSON schemas small and validate outputs.
- **Restricted-scope / unverified-app** friction (see §11).
- **Notifier false negatives:** mitigated by recall bias + LLM-suspicion `/review` + non-destructive design.

## 16. Testing Strategy

- `LLMProvider` and `GmailClient` are **interfaces with mocks/fixtures**.
- **Heaviest coverage on the safety-critical deterministic logic:** risk pass, circuit breaker, undo, memory CRUD, allowlist, cursor/first-run guard.
- LLM-dependent steps get **contract tests** with stubbed responses (no live model in CI).
- Gmail interactions tested against recorded metadata fixtures.

## 17. Future / Out of Scope (designed-for, not built)

- Scheduled auto-cleanup (the cleanup pipeline already exists; only a trigger is missing).
- Gmail **push** (Pub/Sub `users.watch`) as a drop-in replacement for polling behind the same "new-mail source" seam.
- Multi-user onboarding, additional labels/folders, web dashboard.

## 18. Open Questions

None blocking. Setup-time decisions (Vercel plan tier, exact circuit-breaker cap, poll digest formatting) will be settled during implementation planning.
