# Guarded-Trash Rules — Design Spec

**Date:** 2026-07-04
**Status:** Approved (owner approved auto-trash-during-poll, name "guarded trash", full-body judgment, runs at both poll-time and cleanup-time).

## Problem

The owner has senders/domains that are *mostly* junk but occasionally send
something important (a store that blasts marketing but also sends order
confirmations; a newsletter domain that once a month has something real).
A plain `trash` action-rule is too blunt — it would trash the keeper too. The
owner wants a rule that says: **"for this sender, trash the junk on your own,
but read each message first and if it looks important, keep it and flag me."**

## Solution overview

A third rule action alongside `trash` / `archive`: **guarded trash**, stored as
`action: "review"`. For a sender/domain with a review rule, every message is
content-judged (on its **full body**) before any trashing:

- **junk → trashed** (recoverable; logged; reported), and
- **important-looking → kept in the inbox and surfaced** to the owner.

The judgment **biases toward keeping**: since the default disposition is
destruction, the safe error is a false keep, never a false trash.

Guarded trash runs in **both** places:

1. **Poll-time (ongoing):** during the regular ~30-min check, each new message
   from a guarded sender is judged; junk trashed, keepers surfaced in the brief.
2. **Cleanup-time (backlog):** when the owner runs a cleanup that includes a
   guarded sender's mail, matching messages are judged in capped batches; junk
   trashed, keepers returned for the owner's call.

No schema migration: `memories.action` is already a free-text column, so
`"review"` is just a new value.

## Reused primitives (do NOT reinvent)

`vetTrashSet(candidates, {llm, cap})` in `src/cleanup/vet.ts` already implements
exactly the disposition logic guarded trash needs:

- non-bulk → set aside (kept),
- transactional → set aside (kept),
- otherwise the LLM `reviewTrash` decides keep/trash,
- `parseReviewJson` rescues (keep=true) on any parse failure — a built-in
  keep-bias.

`autoTrash` = trash; `setAside` = keep + flag. The **only** thing it lacks is
body-awareness — `TrashCandidate` and the `reviewTrash` prompt see subject only.
Guarded trash adds the body.

## Components & data flow

### 1. LLM judgment on the body (`src/llm/*`)

- `TrashCandidate` (`provider.ts`) gains an optional `bodyText?: string`.
- The Gemini `reviewTrash` prompt includes a truncated body when
  `bodyText` is present; unchanged when absent (the bulk-vet path passes none,
  so its behavior is byte-for-byte the same).
- `parseReviewJson`'s parse-fail-rescue (keep=true) is retained verbatim — this
  IS the keep-bias, so guarded uncertainty defaults to keeping.

### 2. Pure guard judgment (`src/cleanup/guard.ts`, new)

```
guardVet(ids, { gmail, llm, cap }): Promise<{
  trash: string[];
  keep: { id: string; from: string; subject: string; reason: string }[];
  capped: boolean;
}>
```

- `readFull` each id (bounded concurrency via `mapLimit`, capped at `cap`),
- build body-enriched `TrashCandidate`s (`bulk`/`transactional` from
  `riskSignals(meta)`, plus `bodyText`),
- run `vetTrashSet` → map `autoTrash`→`trash`, `setAside`→`keep` (with reason).

Pure: NO trashing, NO logging, NO surfacing — callers own their side effects.
Trivially testable with a fake LLM.

### 3. Poll-time integration (`src/notifier/poll.ts`, `app/api/poll/route.ts`)

- `PollDeps` gains `actionLog: ActionLogRepo`; the poll route passes
  `dbActionLogRepo()`.
- The loop **partitions** the unseen ids by their rule: a guarded id
  (`findRuleFor(...)?.action === "review"`) is collected into a `guarded[]` list;
  every other id follows the existing per-message `classifyEmail` path
  (metadata-only, cheap). This keeps guarded judgment **batched**, not
  per-message — critical, because a per-message loop would fire one Gemini call
  per guarded message and blow the 60s poll cap.
- After the partition, one `guardVet(guarded.slice(0, GUARDED_POLL_CAP), …)` call
  batches all body-reads (`mapLimit`) and a **single** `reviewTrash` LLM call:
  - **keep:** each keeper is pushed to `important` with reason
    `guarded-kept: <reason>` (stays in inbox, deferred-committed like any
    surfaced message),
  - **trash:** `actionLog.record(userId, runId, trash, "trash")` **before**
    `gmail.trash(trash)` (the log-before-mutate invariant). The trashed ids are
    seen-recorded **at commit time** (after the brief is delivered), NOT
    immediately — so if the send fails, the retry re-processes the window and
    **re-reports** the trash rather than skipping it silently (a retry re-trashes
    idempotently). `guardedTrashed = trash.length`.
- Per-cycle safety cap `GUARDED_POLL_CAP` (= 20) on body-reads: guarded messages
  beyond the cap are **kept + surfaced, never trashed unread** (safe overflow —
  the timeout backstop must never cause silent loss).
- `PollResult` gains `guardedTrashed: number`. The route builds its outgoing
  message via the pure `composePollMessage(brief, guardedTrashed)` helper, which
  emits the guarded-trash notice even when there is **no** important mail — so a
  cycle that only trashed guarded junk still notifies the owner. Never silent.

### 4. Cleanup-time integration (`src/cleanup/apply-rules.ts`, `src/cleanup/tools.ts`)

- `bucketByAction` gains a `review: string[]` bucket for items whose rule action
  is `"review"` (counts against the same acted-cap as archive/trash).
- `apply_action_rules` handles the review bucket: `guardVet(b.review, …)` (capped
  body-reads), `actionLog.record(...,"trash")` **before** `gmail.trash(trash)`,
  and returns `guardedTrashed: number` + `guardedKept: {from,subject,id,reason}[]`
  alongside the existing fields, so the agent flags the keepers to the owner.
- The system prompt tells the agent: guarded senders' junk is auto-trashed and
  the kept ones are listed for the owner to confirm keep/trash.

### 5. Rule authoring & display

- `write_memory`'s `action` enum gains `"review"`; system-prompt guidance:
  set `action:"review"` when the owner wants a sender mostly trashed *with a
  safety net* ("trash their stuff but check first / flag anything important").
- Mini-app + settings view render `action:"review"` as **"guarded trash"** (map
  at the view layer; storage stays `"review"`).

## Safety

- **Trash only, always recoverable.** No permanent delete anywhere. `undo_last`
  restores poll- or cleanup-trashed batches because every guarded trash records
  the action-log **before** mutating (same invariant as all existing actions).
- **The one genuinely new behavior — the background poll now trashes mail** — is
  logged, recoverable, seen-tracked (retry-safe), and reported in the brief.
  Never silent.
- **Untrusted body.** The guard *judges* body text; it never follows
  instructions inside it. The existing anti-injection stance is unchanged and
  the guard prompt reiterates it.
- **Keep-bias on uncertainty** and **safe overflow** (unread guarded messages
  are kept, not trashed) mean no code path can lose an important message it
  didn't actually read and judge as junk.

## Out of scope (YAGNI)

- Per-rule custom importance criteria ("keep anything mentioning invoice") — the
  guard uses the same importance bar as the inbox.
- Guarded *archive* (only guarded *trash* for now).
- Backfilling/normalizing existing rules to review.

## Testing

- `guardVet`: junk→trash, important→keep, keep-bias when the LLM parse fails,
  cap honored, body passed through to the candidate.
- `reviewTrash` body enrichment: body included when present, prompt unchanged
  when absent (bulk path regression guard).
- Poll guarded path: junk trashed with **action-log recorded before** the trash
  call; keeper surfaced (not trashed); `guardedTrashed` counted; overflow beyond
  `GUARDED_POLL_CAP` kept-not-trashed; seen recorded for trashed.
- `bucketByAction` review bucket; `apply_action_rules` guarded branch returns
  `guardedKept`/`guardedTrashed` and logs before trashing.
- `write_memory` accepts `action:"review"`; mini-app shows "guarded trash".
