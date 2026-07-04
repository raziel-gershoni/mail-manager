# Guarded-Archive Rules — Design Spec

**Date:** 2026-07-05
**Status:** Approved (owner approved: runs at BOTH poll-time and cleanup-time, symmetric with guarded trash).

## Problem

Guarded trash (`action:"review"`) reads a sender's mail, trashes the junk, and
keeps+surfaces the important ones. Some senders should be *archived* out of the
inbox rather than trashed — a busy list you want out of your face, where the
occasional important message must still reach your inbox and brief. That is
**guarded archive**: the archive counterpart of guarded trash.

Guarded archive and guarded trash differ in exactly ONE thing: what happens to
the *routine* (non-important) mail — **archived (removed from inbox, kept in All
Mail)** vs **trashed**. The body-judgment and the keep+surface behavior for the
important ones are identical. Guarded archive is *gentler*: archive loses
nothing, so its value is attention (keep this sender out of the inbox except the
ones I need), not recovery.

## Solution overview

A fourth rule action, **guarded archive**, stored as `action:"review_archive"`
(sibling to `"review"` = guarded trash). Everything guarded trash does, but the
acted-on set is **archived** instead of trashed. Runs at BOTH poll-time and
cleanup-time. No schema migration (`memories.action` is free text). Guarded trash
(`"review"`) is unchanged and backward compatible.

## Reuse — the judgment is already generic

`guardVet` (`src/cleanup/guard.ts`) already returns "act on these / keep these".
The only coupling to trash is the field name and what the *caller* does with the
acted set. Change:

- Rename `GuardResult.trash` → `GuardResult.act` (pure rename; the verb is the
  caller's choice).
- Callers decide the verb from the rule: `"review"` → `gmail.trash(act)`,
  `"review_archive"` → `gmail.archive(act)`. Both record the action-log FIRST
  (`actionLog.record(..., verb)`) so `undo_last` covers them (it already reverses
  both trash and archive).

## Components & data flow (delta from guarded trash)

### 1. Types & authoring
- `RuleAction` gains `"review_archive"`. `write_memory`'s action enum gains it.
- System prompt: set `action:"review_archive"` when the owner wants a sender's
  routine mail archived-out-of-inbox with the important ones kept + flagged.

### 2. `bucketByAction` (`src/cleanup/apply-rules.ts`)
- Add a `reviewArchive: string[]` bucket (alongside `review`); `"review_archive"`
  items route there, counted against the same acted-cap.

### 3. Cleanup (`apply_action_rules`, `src/cleanup/tools.ts`)
- Process `b.review` with verb `trash` and `b.reviewArchive` with verb `archive`
  (each: `guardVet` capped at `GUARDED_CLEANUP_CAP`, record-before-mutate, act).
- Return `guardedArchived: number` alongside `guardedTrashed`, and a combined
  `guardedKept` list.

### 4. Poll (`src/notifier/poll.ts`, `app/api/poll/route.ts`)
- Partition guarded mail into a trash group (`"review"`) and an archive group
  (`"review_archive"`). Run `guardVet` per group with its verb.
- Record-before-mutate; **defer** the acted ids' seen-record to `commit()` (as
  guarded trash already does) so a failed send + retry re-reports.
- `PollResult` gains `guardedArchived: number` (keeps `guardedTrashed`).
- `composePollMessage(brief, guardedTrashed, guardedArchived)` builds one notice
  covering both (`_Guarded: trashed N junk, archived M routine from watched
  senders (say "undo" to restore)._`) — still never silent, still one pure,
  tested function.

### 5. Display
- `actionLabel` maps `"review"` → "guarded trash", `"review_archive"` →
  "guarded archive".

## Safety (unchanged invariants, now covering archive)
- Archive is recoverable (stays in All Mail; `undo_last` unarchives). No permanent
  delete anywhere.
- Record-before-mutate for the archive verb too; keep-bias and safe overflow
  unchanged (`guardVet` is verb-agnostic).
- The background poll now also archives — logged, recoverable, reported, never
  silent. Untrusted body judged, never obeyed.

## Out of scope (YAGNI)
- Orthogonal guard-flag data model (a `"review"`/`"review_archive"` pair is
  enough for the two sensible guarded verbs; no schema migration).
- Per-rule custom importance criteria.

## Testing (mirror guarded trash, for the archive verb)
- `guardVet`: unchanged behavior under the `act` rename.
- `bucketByAction`: `"review_archive"` → `reviewArchive` bucket.
- Poll guarded-archive: routine archived (action-log recorded BEFORE archive),
  important kept+surfaced, seen deferred, `guardedArchived` counted; a mixed
  cycle (one review + one review_archive sender) trashes one and archives the
  other.
- `apply_action_rules`: guarded-archive branch archives routine, logs first,
  returns `guardedArchived` + `guardedKept`.
- `composePollMessage`: both counts, combined notice, never-silent.
- `write_memory` accepts `"review_archive"`; mini-app shows "guarded archive".
