// src/cleanup/tools.ts
import { randomUUID } from "node:crypto";
import type { ToolDef, ToolContext } from "../agent/tools.js";
import type { TrashCandidate } from "../llm/provider.js";
import { riskSignals } from "../gmail/risk.js";
import { vetTrashSet } from "./vet.js";

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
      const ids = (args.ids as string[]) ?? [];
      const candidates: TrashCandidate[] = [];
      for (const id of ids) {
        const m = await ctx.gmail.getMeta(id);
        const r = riskSignals(m);
        candidates.push({ id, from: m.from, subject: m.subject, bulk: r.bulk, transactional: r.transactional });
      }
      const vet = await vetTrashSet(candidates, { llm: dep.llm });
      const summary = `${vet.autoTrash.length} to trash, ${vet.setAside.length} set aside${vet.capped ? " (capped)" : ""}`;
      const proposal = await dep.proposals.create(ctx.userId, vet.autoTrash, summary);
      return { proposalId: proposal.id, willTrash: vet.autoTrash.length, setAside: vet.setAside, capped: vet.capped, summary };
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
      await dep.actionLog.record(ctx.userId, runId, proposal.messageIds); // record first so undo covers it
      await dep.proposals.markConfirmed(ctx.userId, id);                   // burn the proposal before the failure-prone trash
      await ctx.gmail.trash(proposal.messageIds);
      return { ok: true, trashed: proposal.messageIds.length, runId };
    },
  };
}

export function undoLastTool(): ToolDef {
  return {
    mutating: true,
    schema: { name: "undo_last", description: "Undo the most recent trash action (restores those emails from Trash).",
      parameters: { type: "object", properties: {} } },
    async run(_args, ctx) {
      const dep = requireCleanup(ctx);
      const run = await dep.actionLog.lastUndoable(ctx.userId);
      if (!run) return { ok: false, error: "nothing to undo" };
      await ctx.gmail.untrash(run.messageIds);
      await dep.actionLog.markUndone(ctx.userId, run.runId);
      return { ok: true, restored: run.messageIds.length };
    },
  };
}

export function trashTools(): ToolDef[] {
  return [proposeTrashTool(), confirmTrashTool(), undoLastTool()];
}
