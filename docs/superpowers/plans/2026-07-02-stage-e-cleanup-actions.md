# Stage E: Cleanup Action Rules + Archive + Direct Trash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gmail archive, direct (vet-bypassing) trash/archive of explicitly-named messages, per-sender/domain **action rules** (`trash`/`archive`), and a deterministic `apply_action_rules` that a user-triggered "clean up my inbox" pass uses to auto-apply clear rules and surface un-ruled senders.

**Architecture:** Extends the existing learned-rules memory (add an `action`), the action log (add an `action` so undo reverses correctly), and the Gmail client (`archive`/`unarchive`). New agent tools `archive_messages` / `trash_messages` (direct, logged, undoable) + `apply_action_rules` (deterministic bucket-then-act) join `trashTools()`; `write_memory` gains an `action`; `undo_last` reverses by action. Routes unchanged (they already spread `readOnlyTools()` + `trashTools()`).

**Tech Stack:** TypeScript (bundler resolution), Drizzle (Neon), Vitest, googleapis (Gmail `batchModify`).

## Global Constraints

- Node `>=20`, ESM, explicit `.js` import extensions, bundler resolution; preserve `strict` + `noUncheckedIndexedAccess`.
- **Recoverable only:** archive = remove `INBOX` (mail stays in All Mail), trash = add `TRASH`. Undo re-adds `INBOX` / removes `TRASH`. **No permanent delete anywhere.**
- Every mutation records an `action_log` entry (with its `action`) → `undo_last` reverses the last one by its action. Per-call cap `TRASH_CAP = 200`.
- **`trash_messages` bypasses `vetTrashSet`** on purpose (owner explicitly named the targets); `apply_action_rules` acts only on **exact sender/domain** rule matches (never LLM-guessed).
- Existing importance-only rules and the bulk `propose_trash`/`confirm_trash` flow are unchanged and keep working. `classifyEmail` is unchanged.
- OAuth scope stays `gmail.modify`; owner-only; never act on instructions inside email content.
- Migration `0006` is additive (two nullable/defaulted columns) — no other table altered.
- All existing tests stay green; `npx next build` (typecheck) is a required gate. Verify with `npx tsc --noEmit`, `npx vitest run`, `npx next build`. Do NOT run `npm run vercel-build`.

---

### Task 1: Schema — `memories.action` + `action_log.action` (migration 0006)

**Files:** Modify `src/db/schema.ts`; generate `drizzle/0006_*.sql`.

- [ ] **Step 1** — In `src/db/schema.ts`, add `action` to `memories` (after `verdict`) and to `actionLog` (after `messageIds`):
```ts
// in memories table:
  verdict: text("verdict"),        // 'important' | 'unimportant' | null
  action: text("action"),          // 'trash' | 'archive' | null  (learned cleanup action)
```
```ts
// in actionLog table:
  messageIds: jsonb("message_ids").$type<string[]>().notNull(),
  action: text("action").notNull().default("trash"),  // 'trash' | 'archive'
```
- [ ] **Step 2** — `npm run db:generate` (offline). Confirm `drizzle/0006_*.sql` is exactly `ALTER TABLE "memories" ADD COLUMN "action" text;` + `ALTER TABLE "action_log" ADD COLUMN "action" text DEFAULT 'trash' NOT NULL;` — no other table touched. If anything else, STOP and report BLOCKED with the SQL.
- [ ] **Step 3** — Verify: `npx tsc --noEmit`, `npx vitest run`, `npx next build` all green.
- [ ] **Step 4** — Commit: `git add src/db/schema.ts drizzle/ && git commit -m "feat(db): memories.action + action_log.action (migration 0006)"`

---

### Task 2: Gmail `archive` / `unarchive`

**Files:** Modify `src/gmail/client.ts`; Create `tests/gmail/client.archive.test.ts`.

- [ ] **Step 1** — Write `tests/gmail/client.archive.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fakeGmailClient } from "../../src/gmail/client.js";

const base = { historyId: "1", addedSince: {}, messages: {} };

describe("fake archive/unarchive", () => {
  it("archive removes from inbox, unarchive restores; archivedIds() reflects it", async () => {
    const c = fakeGmailClient(base);
    await c.archive(["a", "b"]);
    expect(c.archivedIds!().sort()).toEqual(["a", "b"]);
    await c.unarchive(["a"]);
    expect(c.archivedIds!()).toEqual(["b"]);
  });
  it("empty ids no-op", async () => {
    const c = fakeGmailClient(base);
    await c.archive([]); await c.unarchive([]);
    expect(c.archivedIds!()).toEqual([]);
  });
});
```
- [ ] **Step 2** — Run → FAIL (`archive` not a function).
- [ ] **Step 3** — In `src/gmail/client.ts`: add to the `GmailClient` interface (after `untrash`):
```ts
  archive(ids: string[]): Promise<void>;
  unarchive(ids: string[]): Promise<void>;
  archivedIds?(): string[]; // test-only introspection (fake)
```
In `googleGmailClient`, add after `untrash`:
```ts
    async archive(ids) {
      if (ids.length === 0) return;
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, removeLabelIds: ["INBOX"] } });
    },
    async unarchive(ids) {
      if (ids.length === 0) return;
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids, addLabelIds: ["INBOX"] } });
    },
```
In `fakeGmailClient`, add `const archivedFromInbox = new Set<string>();` near `const trashed`, then after `untrash`:
```ts
    async archive(ids) { for (const id of ids) archivedFromInbox.add(id); },
    async unarchive(ids) { for (const id of ids) archivedFromInbox.delete(id); },
    archivedIds() { return [...archivedFromInbox]; },
```
- [ ] **Step 4** — Run test → PASS; full suite green; `tsc` clean.
- [ ] **Step 5** — Commit: `git add src/gmail/client.ts tests/gmail/client.archive.test.ts && git commit -m "feat(gmail): archive/unarchive (batchModify ∓INBOX)"`

---

### Task 3: Memory store — carry `action` on rules

**Files:** Modify `src/memory/store.ts`, `src/db/adapters.ts`, `src/agent/tools.ts` (write_memory action param); Modify `tests/memory/store.test.ts`.

- [ ] **Step 1** — Write failing test (append to `tests/memory/store.test.ts`):
```ts
import { inMemoryStore } from "../../src/memory/store.js";
describe("action on rules", () => {
  it("upsertRule stores an action and findRuleFor returns it", () => {
    const s = inMemoryStore();
    s.upsertRule({ matchValue: "linkedin.com", scope: "domain", verdict: "unimportant", description: "LinkedIn", action: "trash" });
    const m = s.findRuleFor("x@linkedin.com", "linkedin.com");
    expect(m).toMatchObject({ verdict: "unimportant", action: "trash" });
  });
  it("action defaults to null when omitted", () => {
    const s = inMemoryStore();
    s.upsertRule({ matchValue: "dana@x.com", scope: "sender", verdict: "important", description: "Dana" });
    expect(s.findRuleFor("dana@x.com", "x.com")?.action ?? null).toBeNull();
  });
});
```
- [ ] **Step 2** — Run → FAIL (`action` not accepted / not returned).
- [ ] **Step 3** — In `src/memory/store.ts`:
  - `MemoryRow`: add `action: string | null;`.
  - `RuleMatch`: add `action: "trash" | "archive" | null;`.
  - `matchRuleIn`: change the return to `return hit ? { slug: hit.slug, verdict: hit.verdict as Verdict, action: (hit.action as "trash" | "archive" | null) ?? null } : null;`.
  - `MemoryStore.upsertRule` signature: `upsertRule(input: { matchValue: string; scope: "sender" | "domain"; verdict: Verdict; description: string; action?: "trash" | "archive" }): MemoryRow;`.
  - `inMemoryStore`: in `upsertSenderRule`, add `action: null` to the created row object. In `upsertRule`, accept `action` and set `action: input.action ?? null` in the created row; on update also set `row.action = input.action ?? row.action`.
  - Everywhere a `MemoryRow` object literal is built in this file, include `action` (default `null`).
- [ ] **Step 4** — In `src/db/adapters.ts` `dbMemoryStore`: map `action: r.action` when loading rows; in `upsertRule` include `action: action ?? null` in the `.values({...})` and `action` in the `onConflictDoUpdate` `set`. Accept the new `action` param (destructure it). `upsertSenderRule` stays importance-only (`action` omitted → column default null on insert; on update leave action as-is — do NOT null it, so use a `set` that omits `action`).
- [ ] **Step 5** — In `src/agent/tools.ts` `write_memory`: add `action` to the schema `properties` (`action: { type: "string", enum: ["trash", "archive"] }`, NOT required) and pass it through: `action: args.action as "trash" | "archive" | undefined`.
- [ ] **Step 6** — Run tests → PASS; full suite green; `tsc` clean; `next build` green.
- [ ] **Step 7** — Commit: `git add src/memory/store.ts src/db/adapters.ts src/agent/tools.ts tests/memory/store.test.ts && git commit -m "feat(memory): learned rules carry a cleanup action"`

---

### Task 4: Action log — carry `action`, undo reverses correctly

**Files:** Modify `src/cleanup/proposals.ts`, `src/db/cleanup-adapters.ts`, `src/cleanup/tools.ts`; Modify `tests/cleanup/tools.undo.test.ts`.

- [ ] **Step 1** — Write failing test (append to `tests/cleanup/tools.undo.test.ts`) — undo of an archive action calls `unarchive`, not `untrash`:
```ts
// Uses fakeActionLogRepo + fakeGmailClient. Record an archive action, then undo_last must unarchive.
it("undo_last reverses an archive action via unarchive", async () => {
  const { undoLastTool } = await import("../../src/cleanup/tools.js");
  const { fakeActionLogRepo, fakeProposalRepo } = await import("../../src/cleanup/proposals.js");
  const { fakeGmailClient } = await import("../../src/gmail/client.js");
  const { fakeAgentLLM } = await import("../../src/llm/provider.js");
  const gmail = fakeGmailClient({ historyId: "1", addedSince: {}, messages: {} });
  await gmail.archive(["m1"]);
  const actionLog = fakeActionLogRepo();
  await actionLog.record(1, "run-1", ["m1"], "archive");
  const ctx: any = { userId: 1, gmail, memory: null, proposals: fakeProposalRepo(), actionLog, llm: fakeAgentLLM(() => ({ kind: "final", text: "" }), () => "") };
  const res = await undoLastTool().run({}, ctx) as any;
  expect(res.ok).toBe(true);
  expect(gmail.archivedIds!()).toEqual([]);       // unarchived
});
```
- [ ] **Step 2** — Run → FAIL (`record` takes 3 args; undo always untrashes).
- [ ] **Step 3** — In `src/cleanup/proposals.ts`:
  - `ActionRun`: add `action: "trash" | "archive";`.
  - `ActionLogRepo.record`: `record(userId: number, runId: string, messageIds: string[], action: "trash" | "archive"): Promise<void>;`.
  - `fakeActionLogRepo`: store `action` on each row; `record` takes+stores it; `lastUndoable` returns `action`.
- [ ] **Step 4** — In `src/db/cleanup-adapters.ts` `dbActionLogRepo`: `record` inserts `action`; `lastUndoable` selects+returns `action` (`action: row.action as "trash" | "archive"`).
- [ ] **Step 5** — In `src/cleanup/tools.ts`:
  - `confirmTrashTool`: change the record call to `await dep.actionLog.record(ctx.userId, runId, proposal.messageIds, "trash");`.
  - `undoLastTool`: after fetching `run`, reverse by action:
    ```ts
    if (run.action === "archive") await ctx.gmail.unarchive(run.messageIds);
    else await ctx.gmail.untrash(run.messageIds);
    ```
    and update its result message to `{ ok: true, restored: run.messageIds.length, action: run.action }`. Update the tool description to "Undo the most recent cleanup action (restores trashed or un-archives the last batch)."
- [ ] **Step 6** — Run tests → PASS (incl. existing undo test); full suite green; `tsc` clean.
- [ ] **Step 7** — Commit: `git add src/cleanup/proposals.ts src/db/cleanup-adapters.ts src/cleanup/tools.ts tests/cleanup/tools.undo.test.ts && git commit -m "feat(cleanup): action_log carries action; undo reverses trash or archive"`

---

### Task 5: Direct tools — `archive_messages` + `trash_messages`

**Files:** Modify `src/cleanup/tools.ts`; Create `tests/cleanup/tools.direct.test.ts`.

- [ ] **Step 1** — Write failing test `tests/cleanup/tools.direct.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { archiveMessagesTool, trashMessagesTool } from "../../src/cleanup/tools.js";
import { fakeActionLogRepo, fakeProposalRepo } from "../../src/cleanup/proposals.js";
import { fakeGmailClient } from "../../src/gmail/client.js";

function ctxWith(gmail: any, actionLog: any) {
  return { userId: 1, gmail, memory: null, proposals: fakeProposalRepo(), actionLog, llm: {} } as any;
}
const gmailOpts = { historyId: "1", addedSince: {}, messages: {} };

describe("direct action tools", () => {
  it("trash_messages trashes named ids (no vet) and logs a trash action", async () => {
    const gmail = fakeGmailClient(gmailOpts); const log = fakeActionLogRepo();
    const res = await trashMessagesTool().run({ ids: ["m1", "m2"], reason: "junk" }, ctxWith(gmail, log)) as any;
    expect(res.ok).toBe(true); expect(res.trashed).toBe(2);
    expect(gmail.trashedIds!().sort()).toEqual(["m1", "m2"]);
    expect((await log.lastUndoable(1))!.action).toBe("trash");
  });
  it("archive_messages archives named ids and logs an archive action", async () => {
    const gmail = fakeGmailClient(gmailOpts); const log = fakeActionLogRepo();
    const res = await archiveMessagesTool().run({ ids: ["m3"], reason: "read it" }, ctxWith(gmail, log)) as any;
    expect(res.ok).toBe(true); expect(res.archived).toBe(1);
    expect(gmail.archivedIds!()).toEqual(["m3"]);
    expect((await log.lastUndoable(1))!.action).toBe("archive");
  });
  it("empty ids is a no-op error", async () => {
    const gmail = fakeGmailClient(gmailOpts);
    const res = await trashMessagesTool().run({ ids: [] }, ctxWith(gmail, fakeActionLogRepo())) as any;
    expect(res.ok).toBe(false);
  });
});
```
- [ ] **Step 2** — Run → FAIL (tools don't exist).
- [ ] **Step 3** — In `src/cleanup/tools.ts`, add both tools (they reuse `requireCleanup` for `actionLog`; a fresh `runId` per call):
```ts
export function archiveMessagesTool(): ToolDef {
  return {
    mutating: true,
    schema: { name: "archive_messages", description: "Archive specific messages by id NOW (removes them from the inbox; they stay in All Mail). Recoverable via undo_last. Use for messages the owner explicitly named.",
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["ids"] } },
    async run(args, ctx) {
      const dep = requireCleanup(ctx);
      const ids = (args.ids as string[]) ?? [];
      if (ids.length === 0) return { ok: false, error: "no ids" };
      const runId = randomUUID();
      await dep.actionLog.record(ctx.userId, runId, ids, "archive");
      await ctx.gmail.archive(ids);
      return { ok: true, archived: ids.length, runId };
    },
  };
}
export function trashMessagesTool(): ToolDef {
  return {
    mutating: true,
    schema: { name: "trash_messages", description: "Trash specific messages by id NOW (moves to Trash, recoverable). Bypasses the bulk-junk vet — use ONLY for messages the owner explicitly named. For a broad 'clean all X junk' sweep, use propose_trash instead.",
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["ids"] } },
    async run(args, ctx) {
      const dep = requireCleanup(ctx);
      const ids = (args.ids as string[]) ?? [];
      if (ids.length === 0) return { ok: false, error: "no ids" };
      const runId = randomUUID();
      await dep.actionLog.record(ctx.userId, runId, ids, "trash"); // record before mutating so undo always covers it
      await ctx.gmail.trash(ids);
      return { ok: true, trashed: ids.length, runId };
    },
  };
}
```
Add both to `trashTools()`: `return [proposeTrashTool(), confirmTrashTool(), undoLastTool(), archiveMessagesTool(), trashMessagesTool()];`
- [ ] **Step 4** — Run tests → PASS; full suite green; `tsc` clean.
- [ ] **Step 5** — Commit: `git add src/cleanup/tools.ts tests/cleanup/tools.direct.test.ts && git commit -m "feat(cleanup): direct archive_messages/trash_messages (named, logged, undoable)"`

---

### Task 6: `apply_action_rules` — deterministic cleanup pass

**Files:** Create `src/cleanup/apply-rules.ts` (pure `bucketByAction`); Modify `src/cleanup/tools.ts` (the tool); Create `tests/cleanup/apply-rules.test.ts`.

**Interfaces:** `bucketByAction(items: { id: string; from: string; subject: string; action: "trash" | "archive" | null }[], cap: number): { archive: string[]; trash: string[]; undecided: { from: string; subject: string; ids: string[] }[]; capped: boolean }`.

- [ ] **Step 1** — Write failing test `tests/cleanup/apply-rules.test.ts` for `bucketByAction`:
```ts
import { describe, it, expect } from "vitest";
import { bucketByAction } from "../../src/cleanup/apply-rules.js";

describe("bucketByAction", () => {
  it("buckets by rule action; groups un-ruled by sender", () => {
    const out = bucketByAction([
      { id: "1", from: "LinkedIn <no-reply@linkedin.com>", subject: "You appeared", action: "trash" },
      { id: "2", from: "Substack <x@substack.com>", subject: "Weekly", action: "archive" },
      { id: "3", from: "Medium <m@medium.com>", subject: "Today", action: null },
      { id: "4", from: "Medium <m@medium.com>", subject: "Daily", action: null },
    ], 200);
    expect(out.trash).toEqual(["1"]);
    expect(out.archive).toEqual(["2"]);
    expect(out.undecided).toEqual([{ from: "Medium <m@medium.com>", subject: "Today", ids: ["3", "4"] }]);
    expect(out.capped).toBe(false);
  });
  it("caps total acted (archive+trash) and marks capped", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), from: "a@b.com", subject: "s", action: "trash" as const }));
    const out = bucketByAction(items, 3);
    expect(out.trash.length).toBe(3);
    expect(out.capped).toBe(true);
  });
});
```
- [ ] **Step 2** — Run → FAIL (module missing).
- [ ] **Step 3** — Implement `src/cleanup/apply-rules.ts`:
```ts
export interface ActionItem { id: string; from: string; subject: string; action: "trash" | "archive" | null; }
export interface CleanupBuckets { archive: string[]; trash: string[]; undecided: { from: string; subject: string; ids: string[] }[]; capped: boolean; }

export function bucketByAction(items: ActionItem[], cap: number): CleanupBuckets {
  const archive: string[] = [], trash: string[] = [];
  const undecidedMap = new Map<string, { from: string; subject: string; ids: string[] }>();
  let acted = 0, capped = false;
  for (const it of items) {
    if (it.action === null) {
      const g = undecidedMap.get(it.from) ?? { from: it.from, subject: it.subject, ids: [] };
      g.ids.push(it.id); undecidedMap.set(it.from, g);
      continue;
    }
    if (acted >= cap) { capped = true; continue; } // overflow left for the next run
    if (it.action === "archive") archive.push(it.id); else trash.push(it.id);
    acted++;
  }
  return { archive, trash, undecided: [...undecidedMap.values()], capped };
}
```
- [ ] **Step 4** — Run → PASS. Then add the tool to `src/cleanup/tools.ts` (imports `bucketByAction`, `TRASH_CAP` from `./vet.js`; uses `ctx.memory.findRuleFor`):
```ts
import { vetTrashSet, TRASH_CAP } from "./vet.js";
import { bucketByAction } from "./apply-rules.js";
// ...
export function applyActionRulesTool(): ToolDef {
  return {
    mutating: true,
    schema: { name: "apply_action_rules", description: "For the given message ids, auto-archive/trash the ones matching a learned action rule (by exact sender/domain), and return the ids with NO rule grouped by sender so you can ask the owner. Use this for 'clean up my inbox'.",
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } },
    async run(args, ctx) {
      const dep = requireCleanup(ctx);
      const ids = (args.ids as string[]) ?? [];
      const items = [];
      for (const id of ids) {
        const m = await ctx.gmail.getMeta(id);
        const rule = ctx.memory.findRuleFor(m.fromEmail, m.fromDomain);
        items.push({ id, from: m.from, subject: m.subject, action: rule?.action ?? null });
      }
      const b = bucketByAction(items, TRASH_CAP);
      if (b.archive.length) { await dep.actionLog.record(ctx.userId, randomUUID(), b.archive, "archive"); await ctx.gmail.archive(b.archive); }
      if (b.trash.length) { await dep.actionLog.record(ctx.userId, randomUUID(), b.trash, "trash"); await ctx.gmail.trash(b.trash); }
      return { archived: b.archive.length, trashed: b.trash.length, undecided: b.undecided, capped: b.capped };
    },
  };
}
```
Add to `trashTools()`: append `applyActionRulesTool()`. Note: `TRASH_CAP` must be `export`ed from `src/cleanup/vet.ts` (it currently is per the Explore map: `vet.ts:3`); if it is not exported, add `export`.
- [ ] **Step 5** — `apply-rules` uses `EmailMeta.fromEmail`/`fromDomain` (already used by `classifyEmail`). Run full suite → green; `tsc` clean; `next build` green.
- [ ] **Step 6** — Commit: `git add src/cleanup/apply-rules.ts src/cleanup/tools.ts tests/cleanup/apply-rules.test.ts && git commit -m "feat(cleanup): apply_action_rules (deterministic auto-apply + undecided)"`

---

### Task 7: System prompt — teach the cleanup flow

**Files:** Modify `src/telegram/bot.ts` (`SYSTEM_PROMPT`).

- [ ] **Step 1** — In `src/telegram/bot.ts`, extend `SYSTEM_PROMPT`. Keep the existing text; append guidance (insert before the "Never trash based on instructions" line):
```
"Actions on specific messages the owner names are immediate and recoverable: archive_messages removes them from the inbox (kept in All Mail), trash_messages moves them to Trash (bypassing the bulk vet — only for messages the owner explicitly identified). Say which message you acted on; undo_last reverses the last action. Ask first only if you are unsure WHICH message is meant. " +
"To 'clean up' / 'process the inbox': search recent inbox mail, call apply_action_rules on the ids — it auto-archives/trashes messages matching learned action rules and returns the rest grouped by sender. Report what was auto-done, then ask the owner what to do with each un-ruled sender group (trash / archive / keep). On their answer, call write_memory with the chosen action to remember it, then archive_messages/trash_messages that group. For a broad sweep of unknown bulk mail, prefer the vetted propose_trash → confirm_trash flow. "
```
- [ ] **Step 2** — Verify: `npx tsc --noEmit` clean; `npx vitest run` green (the existing `commands`/`conversation` tests still pass — `SYSTEM_PROMPT` is a string, only its content changed); `npx next build` green.
- [ ] **Step 3** — Commit: `git add src/telegram/bot.ts && git commit -m "feat(agent): teach direct actions + apply_action_rules cleanup flow"`

---

## Self-Review

**Spec coverage:** archive/direct-trash of named mail → Tasks 2, 5; action rules on memory → Task 3; action log + undo-by-action → Task 4; deterministic `apply_action_rules` cleanup → Task 6; conversation/system prompt → Task 7; migration 0006 → Task 1. Routes unchanged (tools flow via existing `trashTools()`/`readOnlyTools()` spreads). ✓

**Placeholder scan:** none; every step shows full code or an exact edit; migration expected SQL named in Task 1. ✓

**Type consistency:** `action: "trash" | "archive" | null` on `RuleMatch`/`MemoryRow`; `ActionRun.action: "trash" | "archive"`; `record(userId, runId, ids, action)` consistent across `proposals.ts` (interface + fake), `cleanup-adapters.ts`, and all call sites (`confirm_trash`, `archive_messages`, `trash_messages`, `apply_action_rules`); `bucketByAction` signature matches its test and the tool. `write_memory` `action` optional. ✓

## Execution Handoff

After all tasks pass, run an opus whole-branch review (the destructive rail is the focus: confirm archive/trash stay recoverable, undo reverses the correct way, `apply_action_rules` only acts on exact-match rules, `trash_messages`'s vet-bypass is intentional + logged + undoable, migration 0006 additive), then merge to `main` via `superpowers:finishing-a-development-branch` (production deploy, migration 0006).
