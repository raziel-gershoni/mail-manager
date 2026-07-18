# Rule Signs in Mail Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark already-ruled senders in the bot's conversational mail listings with a sign showing what the rule does.

**Architecture:** A pure helper maps a sender/domain rule to a compact tag; the two mail-listing tools (`search_gmail`, `read_messages`) attach that tag per result via the existing `findRuleFor`; the SYSTEM_PROMPT owns the sign legend and tells the model to prefix each ruled email.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-rule-sign-in-mail-listings-design.md`

## Global Constraints

- **The mark is deterministic** — computed in code from stored rules, never left to the model to guess. `rule` is trusted; from/subject stay UNTRUSTED.
- **Sender/domain rules only.** Topic preferences are never marked (they can't be pinned to a specific message).
- **Conversational replies only.** Do not touch the poll digest.
- **No proactive offer** — only mark; do not append "want me to rule these?".
- Sign legend (in the SYSTEM_PROMPT): 🗑 auto-trash, 📥 auto-archive, 🛡 guarded, ✅ keep, ⭐ important, 🔕 ignore; `rule: null` → no mark.
- TypeScript ESM: import specifiers keep the `.js` extension even for `.ts` files.
- Run `npx vitest run` and `npx tsc --noEmit` before every commit.

---

### Task 1: Pure `ruleTag` helper

**Files:**
- Create: `src/agent/rule-tag.ts`
- Test: `tests/agent/rule-tag.test.ts`

**Interfaces:**
- Consumes: `RuleMatch` from `src/memory/store.js` — `{ slug: string; verdict: "important" | "unimportant"; action: "trash" | "archive" | "review" | "review_archive" | "keep" | null }`.
- Produces: `type RuleTagKind = "auto-trash" | "auto-archive" | "guarded" | "keep" | "important" | "ignore"`; `interface RuleTag { kind: RuleTagKind; scope: string; matchValue: string }`; `ruleTag(rule: RuleMatch | null): RuleTag | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent/rule-tag.test.ts
import { describe, it, expect } from "vitest";
import { ruleTag } from "../../src/agent/rule-tag.js";
import type { RuleMatch } from "../../src/memory/store.js";

const rm = (slug: string, action: RuleMatch["action"], verdict: RuleMatch["verdict"] = "unimportant"): RuleMatch => ({ slug, verdict, action });

describe("ruleTag", () => {
  it("maps each action to its kind and parses scope/matchValue from the slug", () => {
    expect(ruleTag(rm("domain:linkedin.com", "trash"))).toEqual({ kind: "auto-trash", scope: "domain", matchValue: "linkedin.com" });
    expect(ruleTag(rm("sender:jane@work.com", "archive"))).toEqual({ kind: "auto-archive", scope: "sender", matchValue: "jane@work.com" });
    expect(ruleTag(rm("domain:x.com", "review"))).toMatchObject({ kind: "guarded" });
    expect(ruleTag(rm("domain:x.com", "review_archive"))).toMatchObject({ kind: "guarded" });
    expect(ruleTag(rm("sender:a@b.com", "keep"))).toMatchObject({ kind: "keep" });
  });
  it("maps a verdict-only rule (action null) by verdict", () => {
    expect(ruleTag(rm("sender:vip@x.com", null, "important"))).toMatchObject({ kind: "important" });
    expect(ruleTag(rm("domain:spam.com", null, "unimportant"))).toMatchObject({ kind: "ignore" });
  });
  it("returns null when there is no rule", () => {
    expect(ruleTag(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/rule-tag.test.ts`
Expected: FAIL — cannot resolve `../../src/agent/rule-tag.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/agent/rule-tag.ts
import type { RuleMatch } from "../memory/store.js";

export type RuleTagKind = "auto-trash" | "auto-archive" | "guarded" | "keep" | "important" | "ignore";
export interface RuleTag { kind: RuleTagKind; scope: string; matchValue: string; }

// Map a sender/domain rule to a compact, LLM-facing tag. null in → null out (no
// rule → no mark). scope/matchValue are parsed from the slug ("domain:x.com") so
// the bot can name the rule if the owner asks. Trusted: derived from stored rules,
// not from email content.
export function ruleTag(rule: RuleMatch | null): RuleTag | null {
  if (!rule) return null;
  const i = rule.slug.indexOf(":");
  const scope = i >= 0 ? rule.slug.slice(0, i) : rule.slug;
  const matchValue = i >= 0 ? rule.slug.slice(i + 1) : "";
  let kind: RuleTagKind;
  switch (rule.action) {
    case "trash": kind = "auto-trash"; break;
    case "archive": kind = "auto-archive"; break;
    case "review": case "review_archive": kind = "guarded"; break;
    case "keep": kind = "keep"; break;
    default: kind = rule.verdict === "important" ? "important" : "ignore"; // verdict-only rule (action null)
  }
  return { kind, scope, matchValue };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/rule-tag.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/agent/rule-tag.ts tests/agent/rule-tag.test.ts
git commit -m "feat(rule-tag): pure helper mapping a sender/domain rule to a sign tag"
```

---

### Task 2: Annotate the listing tools + prompt legend

**Files:**
- Modify: `src/agent/tools.ts` (`search_gmail` run ~line 47; `read_messages` run ~lines 67-71; add import)
- Modify: `src/telegram/bot.ts` (SYSTEM_PROMPT — add one line near the existing rules/cleanup guidance)
- Test: `tests/agent/tools.rule-annotation.test.ts` (new); `tests/telegram/system-prompt.test.ts` (extend)

**Interfaces:**
- Consumes: `ruleTag` + `RuleTag` from `src/agent/rule-tag.js` (Task 1); `ctx.memory.findRuleFor(fromEmail, fromDomain)` (returns `RuleMatch | null`); `EmailMeta` fields `fromEmail`, `fromDomain`.
- Produces: `search_gmail` results are `EmailMeta & { rule: RuleTag | null }`; `read_messages` results are `{ id, from, subject, bodyText, rule: RuleTag | null }`.

- [ ] **Step 1: Write the failing annotation test**

```ts
// tests/agent/tools.rule-annotation.test.ts
import { describe, it, expect } from "vitest";
import { readOnlyTools } from "../../src/agent/tools.js";
import { inMemoryStore } from "../../src/memory/store.js";
import { fakeGmailClient } from "../../src/gmail/client.js";

const tool = (name: string) => readOnlyTools().find(t => t.schema.name === name)!;

function ctx() {
  const memory = inMemoryStore();
  // a domain trash rule for shop.com; jane@x.com is left un-ruled
  memory.upsertRule({ matchValue: "shop.com", scope: "domain", verdict: "unimportant", description: "shop", action: "trash" });
  const gmail = fakeGmailClient({
    historyId: "1", addedSince: {},
    messages: {
      a: { id: "a", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "promo@shop.com" }, { name: "Subject", value: "Sale" }] } },
      b: { id: "b", threadId: "t", snippet: "", payload: { headers: [{ name: "From", value: "jane@x.com" }, { name: "Subject", value: "Lunch" }] } },
    },
    searchResults: { "in:inbox from:test": ["a", "b"] }, // scopeSearchToInbox prefixes in:inbox
    bodies: { a: "buy now", b: "hi" },
  });
  return { userId: 1, memory, gmail } as any;
}

describe("search_gmail rule annotation", () => {
  it("tags a ruled sender with its rule kind and leaves an un-ruled sender null, preserving other fields", async () => {
    const res = await tool("search_gmail").run({ query: "from:test" }, ctx()) as any[];
    const byEmail = Object.fromEntries(res.map(r => [r.fromEmail, r]));
    expect(byEmail["promo@shop.com"].rule).toEqual({ kind: "auto-trash", scope: "domain", matchValue: "shop.com" });
    expect(byEmail["jane@x.com"].rule).toBeNull();
    expect(byEmail["promo@shop.com"].subject).toBe("Sale"); // existing fields intact
  });
});

describe("read_messages rule annotation", () => {
  it("tags each read message by its sender's rule, preserving id/body", async () => {
    const res = await tool("read_messages").run({ ids: ["a", "b"] }, ctx()) as any[];
    const a = res.find(r => r.id === "a"); const b = res.find(r => r.id === "b");
    expect(a.rule).toEqual({ kind: "auto-trash", scope: "domain", matchValue: "shop.com" });
    expect(a.bodyText).toBe("buy now");
    expect(b.rule).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent/tools.rule-annotation.test.ts`
Expected: FAIL — `rule` is `undefined` on the results (`expected undefined to equal { kind: "auto-trash", ... }`).

- [ ] **Step 3: Annotate the two tools**

In `src/agent/tools.ts`, add the import at the top (next to the other imports):

```ts
import { ruleTag } from "./rule-tag.js";
```

Replace the `search_gmail` `run` (currently `async run(args, ctx) { return ctx.gmail.search(scopeSearchToInbox(String(args.query ?? ""))); }`) with:

```ts
      async run(args, ctx) {
        const metas = await ctx.gmail.search(scopeSearchToInbox(String(args.query ?? "")));
        return metas.map(m => ({ ...m, rule: ruleTag(ctx.memory.findRuleFor(m.fromEmail, m.fromDomain)) }));
      },
```

Replace the `read_messages` `run` body's `return` (currently `return fulls.map((f, i) => ({ id: ids[i]!, from: f.meta.from, subject: f.meta.subject, bodyText: f.bodyText }));`) with:

```ts
        return fulls.map((f, i) => ({ id: ids[i]!, from: f.meta.from, subject: f.meta.subject, bodyText: f.bodyText, rule: ruleTag(ctx.memory.findRuleFor(f.meta.fromEmail, f.meta.fromDomain)) }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent/tools.rule-annotation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the SYSTEM_PROMPT legend block**

In `src/telegram/bot.ts`, add this line to `SYSTEM_PROMPT` (it is a `+`-concatenated set of quoted strings; place this next to the existing rules/cleanup guidance, e.g. right after the "To review the learned rules…" line):

```ts
  "When you list the owner's emails from search_gmail or read_messages, mark each whose sender already has a learned rule so the owner sees at a glance what is handled. Each result carries a `rule` field — TRUSTED, computed from the stored rules, not the email. rule: null means no rule — leave it unmarked (those senders are still open to rule). Otherwise prefix that email with the sign for rule.kind: 🗑 auto-trash, 📥 auto-archive, 🛡 guarded, ✅ keep, ⭐ important, 🔕 ignore. Never put a sign on a rule: null message, and never mark a topic preference (only sender/domain rules produce this field). This only sets the per-email prefix — format the rest of the reply however fits. " +
```

- [ ] **Step 6: Guard the legend with a prompt test**

`tests/telegram/system-prompt.test.ts` already imports the prompt (`import { SYSTEM_PROMPT } from "../../src/telegram/bot.js";`) and asserts against it with `expect(SYSTEM_PROMPT).toMatch(...)`. Add one test inside its existing `describe`, in that same style, asserting the legend shipped (fails if the block is reverted):

```ts
  it("documents the rule-sign legend for mail listings", () => {
    for (const sign of ["🗑", "📥", "🛡", "✅", "⭐", "🔕"]) expect(SYSTEM_PROMPT).toContain(sign);
    expect(SYSTEM_PROMPT).toMatch(/rule: null means no rule/i);
  });
```

- [ ] **Step 7: Full suite, typecheck, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — full suite green (the two new annotation tests + the legend test on top of the existing count).

```bash
git add src/agent/tools.ts src/telegram/bot.ts tests/agent/tools.rule-annotation.test.ts tests/telegram/system-prompt.test.ts
git commit -m "feat(tools): tag listed mail with the sender's rule; SYSTEM_PROMPT sign legend"
```

---

## Notes for the implementer

- **Import specifiers keep `.js`** even for `.ts` files (ESM).
- `search_gmail` currently returns raw `EmailMeta[]`; spreading `...m` preserves every existing field (from, subject, id, fromEmail, fromDomain, snippet, date, headers, labelIds) and only adds `rule`. Do not drop or rename any field.
- Do not touch `findRuleFor`, the poll, the digest, or preferences. This is presentation only.
- `findRuleFor` is an in-memory scan over already-loaded rows — calling it per result (≤25 for search, ≤10 for read) is cheap; no batching needed.
