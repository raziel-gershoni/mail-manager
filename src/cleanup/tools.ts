// src/cleanup/tools.ts
import { randomUUID } from "node:crypto";
import type { ToolDef, ToolContext } from "../agent/tools.js";
import type { TrashCandidate } from "../llm/provider.js";
import { riskSignals } from "../gmail/risk.js";
import { vetTrashSet, TRASH_CAP } from "./vet.js";
import { bucketByAction } from "./apply-rules.js";
import { guardVet } from "./guard.js";
import { GMAIL_FETCH_CONCURRENCY } from "../gmail/client.js";
import { mapLimit } from "../util/concurrency.js";

// Guarded (review) senders read FULL bodies, so cap the per-run body-reads well
// below TRASH_CAP to stay within budget. Overflow is reported via `capped` for a
// repeat run — nothing is trashed unread.
const GUARDED_CLEANUP_CAP = 20;

function requireCleanup(ctx: ToolContext) {
  if (!ctx.proposals || !ctx.actionLog || !ctx.llm) throw new Error("cleanup deps unavailable");
  return { proposals: ctx.proposals, actionLog: ctx.actionLog, llm: ctx.llm };
}

export function proposeTrashTool(): ToolDef {
  return {
    mutating: false, // writes a proposal row but trashes nothing; gated execution is confirm_trash
    schema: { name: "propose_trash", description: "Vet a set of message ids for trashing and create a pending proposal. Returns what will be trashed and what was set aside. Does NOT trash anything.",
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["ids", "reason"] } },
    async run(args, ctx) {
      const dep = requireCleanup(ctx);
      const rawIds = (args.ids as string[]) ?? [];
      const ids = rawIds.slice(0, TRASH_CAP);
      const metas = await mapLimit(ids, GMAIL_FETCH_CONCURRENCY, (id) => ctx.gmail.getMeta(id));
      const candidates: TrashCandidate[] = metas.map((m, i) => {
        const r = riskSignals(m);
        return { id: ids[i]!, from: m.from, subject: m.subject, bulk: r.bulk, transactional: r.transactional };
      });
      const vet = await vetTrashSet(candidates, { llm: dep.llm });
      const capped = vet.capped || rawIds.length > TRASH_CAP;
      const summary = `${vet.autoTrash.length} to trash, ${vet.setAside.length} set aside${capped ? " (capped)" : ""}`;
      const proposal = await dep.proposals.create(ctx.userId, vet.autoTrash, summary);
      return { proposalId: proposal.id, willTrash: vet.autoTrash.length, setAside: vet.setAside, capped, summary };
    },
  };
}

export function confirmTrashTool(): ToolDef {
  return {
    mutating: true,
    schema: { name: "confirm_trash", description: "Execute a pending trash proposal by id (moves its emails to Trash, recoverable). Only call after the owner has approved.",
      parameters: { type: "object", properties: { proposalId: { type: "number" } }, required: ["proposalId"] } },
    async run(args, ctx) {
      const dep = requireCleanup(ctx);
      const id = Number(args.proposalId);
      const proposal = await dep.proposals.get(ctx.userId, id);
      if (!proposal) return { ok: false, error: "proposal not found" };
      if (proposal.status !== "pending") return { ok: false, error: `proposal is ${proposal.status}` };
      const runId = randomUUID();
      await dep.actionLog.record(ctx.userId, runId, proposal.messageIds, "trash"); // record first so undo covers it
      await dep.proposals.markConfirmed(ctx.userId, id);                   // burn the proposal before the failure-prone trash
      await ctx.gmail.trash(proposal.messageIds);
      return { ok: true, trashed: proposal.messageIds.length, runId };
    },
  };
}

export function undoLastTool(): ToolDef {
  return {
    mutating: true,
    schema: { name: "undo_last", description: "Undo the most recent cleanup action (restores trashed or un-archives the last batch).",
      parameters: { type: "object", properties: {} } },
    async run(_args, ctx) {
      const dep = requireCleanup(ctx);
      const run = await dep.actionLog.lastUndoable(ctx.userId);
      if (!run) return { ok: false, error: "nothing to undo" };
      if (run.action === "archive") await ctx.gmail.unarchive(run.messageIds);
      else await ctx.gmail.untrash(run.messageIds);
      await dep.actionLog.markUndone(ctx.userId, run.runId);
      return { ok: true, restored: run.messageIds.length, action: run.action };
    },
  };
}

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

export function applyActionRulesTool(): ToolDef {
  return {
    mutating: true,
    schema: { name: "apply_action_rules", description: "For the given message ids, auto-archive/trash the ones matching a learned action rule (by exact sender/domain), read+judge the ones matching a guarded-trash ('review') rule (trashing junk, returning importable keepers in guardedKept), and return the ids with NO rule grouped by sender so you can ask the owner. Use this for 'clean up my inbox'.",
      parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } },
    async run(args, ctx) {
      const dep = requireCleanup(ctx);
      const rawIds = (args.ids as string[]) ?? [];
      const ids = rawIds.slice(0, TRASH_CAP);
      const metas = await mapLimit(ids, GMAIL_FETCH_CONCURRENCY, (id) => ctx.gmail.getMeta(id));
      const items = metas.map((m, i) => {
        const rule = ctx.memory.findRuleFor(m.fromEmail, m.fromDomain);
        return { id: ids[i]!, from: m.from, subject: m.subject, action: rule?.action ?? null };
      });
      const b = bucketByAction(items, TRASH_CAP);
      if (b.archive.length) { await dep.actionLog.record(ctx.userId, randomUUID(), b.archive, "archive"); await ctx.gmail.archive(b.archive); }
      if (b.trash.length) { await dep.actionLog.record(ctx.userId, randomUUID(), b.trash, "trash"); await ctx.gmail.trash(b.trash); }
      // Guarded senders: read bodies (capped), trash the junk (logged first), keep the rest.
      let guardedTrashed = 0;
      let guardedKept: { id: string; from: string; subject: string; reason: string }[] = [];
      let guardedCapped = false;
      if (b.review.length) {
        const g = await guardVet(b.review, { gmail: ctx.gmail, llm: dep.llm, cap: GUARDED_CLEANUP_CAP });
        if (g.trash.length) { await dep.actionLog.record(ctx.userId, randomUUID(), g.trash, "trash"); await ctx.gmail.trash(g.trash); }
        guardedTrashed = g.trash.length;
        guardedKept = g.keep;
        guardedCapped = g.capped;
      }
      return { archived: b.archive.length, trashed: b.trash.length, guardedTrashed, guardedKept, undecided: b.undecided, capped: b.capped || guardedCapped || rawIds.length > TRASH_CAP };
    },
  };
}

export function trashTools(): ToolDef[] {
  return [proposeTrashTool(), confirmTrashTool(), undoLastTool(), archiveMessagesTool(), trashMessagesTool(), applyActionRulesTool()];
}
