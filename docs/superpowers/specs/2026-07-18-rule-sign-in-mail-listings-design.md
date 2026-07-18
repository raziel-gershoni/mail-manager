# Rule Signs in Mail Listings — Design

**Date:** 2026-07-18
**Status:** Approved

## 1. Goal

When the bot lists the owner's emails in a conversational reply, mark each message whose **sender already has a learned rule** with a sign that shows **what the rule does** — so the owner can tell at a glance which senders are already handled and which are still open to rule.

## 2. Why deterministic, not LLM-guessed

The mark must be trustworthy: an "already handled" sign that is sometimes wrong is worse than no sign. Today the LLM would have to cross-reference `list_memories` by hand (the SYSTEM_PROMPT even tells it to, for "why did you trash that?"), which is unreliable.

Instead, the code attaches the rule to each listed message. `MemoryStore.findRuleFor(fromEmail, fromDomain)` already returns the exact sender/domain rule (`{ slug, verdict, action } | null`), and the two listing tools already have `fromEmail`/`fromDomain` per result. So the signal is computed at query time from the current rules — always accurate, never stale, and **trusted** (derived from stored rules, not from untrusted email content).

## 3. Scope (non-goals)

- **Conversational replies only.** The ~30-min poll digest already separates "new senders you haven't ruled" (`unruled`); this feature does not touch the digest.
- **Sender/domain rules only.** A standing *preference* is a topic judgment (an LLM decision per message), so it cannot be pinned to a specific message deterministically. Marking preferences would make the sign unreliable, so preferences are **not** marked. (An email may still separately match a preference; that is out of scope for this sign.)
- **No proactive offer.** The bot only marks; it does not append "want me to rule these?" The absence of a mark already invites the owner to ask.
- No change to how rules are matched, stored, or applied.

## 4. The tag (pure helper)

New module `src/agent/rule-tag.ts`:

```ts
import type { RuleMatch } from "../memory/store.js";

export type RuleTagKind = "auto-trash" | "auto-archive" | "guarded" | "keep" | "important" | "ignore";
export interface RuleTag { kind: RuleTagKind; scope: string; matchValue: string; }

// Map a sender/domain rule to a compact, LLM-facing tag. null in → null out
// (no rule → no mark). scope/matchValue are parsed from the slug ("domain:x.com")
// so the bot can name the rule ("domain x.com → auto-trash") if asked.
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

**Sign legend** (lives in the SYSTEM_PROMPT, not the data — the tool carries the meaning, the prompt owns the sign):

| `kind` | rule (`action` / verdict) | sign |
|---|---|---|
| auto-trash | action `trash` | 🗑 |
| auto-archive | action `archive` | 📥 |
| guarded | action `review` / `review_archive` | 🛡 |
| keep | action `keep` | ✅ |
| important | verdict `important`, no action | ⭐ |
| ignore | verdict `unimportant`, no action | 🔕 |
| (none) | no rule → `rule: null` | (no mark) |

## 5. Tool annotation

Both mail-listing tools in `src/agent/tools.ts` add a `rule` field per message via `ruleTag(ctx.memory.findRuleFor(fromEmail, fromDomain))`. `findRuleFor` is an in-memory scan over the user's already-loaded rules, so the ≤25 extra calls per search are cheap.

- **`search_gmail`** (the primary lister): returns `metas.map(m => ({ ...m, rule: ruleTag(ctx.memory.findRuleFor(m.fromEmail, m.fromDomain)) }))`.
- **`read_messages`**: adds `rule` alongside the existing `{ id, from, subject, bodyText }`, so a mail shown after being read carries the same mark as in a search list (consistency — no surprising mismatch).

`rule` is `RuleTag | null`. The from/subject stay untrusted; `rule` is trusted.

## 6. Prompt guidance

One block added to `SYSTEM_PROMPT` in `src/telegram/bot.ts`:

> When you list the owner's emails from `search_gmail` or `read_messages`, mark each one whose sender already has a learned rule so the owner sees at a glance what is handled. Each result carries a `rule` field — trusted, computed from the stored rules, not the email. `rule: null` → no rule, leave it unmarked (those are the senders still open to rule). Otherwise prefix the email with the sign for `rule.kind`: 🗑 auto-trash, 📥 auto-archive, 🛡 guarded, ✅ keep, ⭐ important, 🔕 ignore. Never put a sign on a `rule: null` message.

The guidance constrains only the per-email prefix, not the rest of the reply's format.

## 7. Testing

- `tests/agent/rule-tag.test.ts` — pure: each action (`trash`/`archive`/`review`/`review_archive`/`keep`) and each verdict-only case (`important` → important, `unimportant` → ignore) maps to the right `kind`; `null` → `null`; scope/matchValue parsed from both a `sender:` and a `domain:` slug.
- `tests/agent/tools.rule-annotation.test.ts` — `search_gmail` and `read_messages` run against a fake gmail + a store seeded with a rule: the ruled sender's result carries the expected `rule.kind`, an unruled sender's result carries `rule: null`, and no other field is dropped.

## 8. Files

- **Create:** `src/agent/rule-tag.ts`, `tests/agent/rule-tag.test.ts`, `tests/agent/tools.rule-annotation.test.ts`
- **Modify:** `src/agent/tools.ts` (import `ruleTag`; annotate `search_gmail` and `read_messages`), `src/telegram/bot.ts` (SYSTEM_PROMPT block)
