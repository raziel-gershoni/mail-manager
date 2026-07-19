# Rule Signs in the 30-min Digest — Design

**Date:** 2026-07-19
**Status:** Approved

## 1. Goal

Extend the rule-sign feature (conversational listings) to the ~30-min poll digest: give the digest's important-mail brief the same per-sender rule information, so the owner sees — woven into the friendly prose — which surfaced important mails come from senders that already have a rule, and what that rule does.

## 2. Current state

The digest's important section is a **prose** brief: `generateBrief` (`src/notifier/brief.ts`) reads the surfaced-important bodies into `BriefEmail[] = { from, subject, bodyText }` and calls `LLMProvider.writeBrief(emails, context)` (`src/llm/gemini.ts:151`), which returns a friendly natural-language summary. It has no rule information today, so it can't mark anything. This is a **separate path** from `search_gmail`/`read_messages` — the conversational sign feature does not reach it.

## 3. Approach — woven into the prose (chosen)

Keep the narrative brief. The **code** computes each brief email's rule tag deterministically (the existing `ruleTag(findRuleFor(...))` path — trusted, not LLM-guessed), threads it into `writeBrief`, and the brief prompt is told to weave the sign in where it helps the owner. The writer decides placement; marking may be selective rather than one-per-line (accepted trade-off of the prose style).

## 4. Non-goals

- **Only the surfaced-important mails** (what the brief covers) are signed. In practice these are guarded-kept senders (🛡🗑 / 🛡📥) and important-ruled senders (⭐); un-ruled important mail gets no sign. Auto-trashed/archived mail is not in the brief (it is in the count line) and is unaffected.
- **The count line and the "new senders you haven't ruled" line are unchanged** (`composePollMessage`). Those un-ruled senders are the inverse of the signs and stay a grouped callout.
- **The code-built fallback list** (`app/api/poll/route.ts`, used only when `writeBrief` returns empty) stays unmarked — a rare degraded path; out of scope.
- No change to rule matching, storage, or actions; no new LLM call (the sign rides the existing `writeBrief` call).

## 5. Sign legend

Same as the conversational feature (`ruleTag`'s `RuleTagKind`): 🗑 auto-trash, 📥 auto-archive, 🛡🗑 guarded-trash, 🛡📥 guarded-archive, ✅ keep, ⭐ important, 🔕 ignore; no rule → no sign. The legend must live in the `writeBrief` prompt itself (that call has no SYSTEM_PROMPT).

## 6. Components

**`BriefEmail` (`src/llm/provider.ts`)** gains `rule?: RuleTag | null` (import `RuleTag` from `src/agent/rule-tag.js`). Optional, so existing constructors/fakes stay valid.

**`generateBrief` (`src/notifier/brief.ts`)** deps gain `store?: MemoryStore` — **optional**, matching the existing optional `timezone?`/`language?` deps (and keeping existing tests that pass no store valid). When present, for each email (it already reads `meta` via `readFull`/`getMeta`) it computes `rule: ruleTag(deps.store.findRuleFor(meta.fromEmail, meta.fromDomain))` and puts it on the `BriefEmail`; when absent, `rule` is left undefined (→ no sign). The production caller (the poll route) always passes it.

**`writeBrief` (`src/llm/gemini.ts`)** — extract the per-email rendering into a pure, exported `briefEmailBlock(emails: BriefEmail[]): string` that emits `From / Subject / rule: <kind> (<scope> <matchValue>)` (or `rule: none`) / `Body (UNTRUSTED …)`. `writeBrief` calls it and its instruction text gains the legend + a "weave the sign in where it helps the owner see what's already handled; don't force it onto every line; `rule: none` → don't mark" clause. Bodies stay UNTRUSTED; `rule` is trusted.

**`app/api/poll/route.ts`** — hoist the already-created `await dbMemoryStore(userId)` (currently inline in the `runPoll` call at line 49) into a `const store`, pass it to both `runPoll` and `generateBrief`.

## 7. Testing

- `briefEmailBlock` (pure): a ruled email renders `rule: guarded-archive (...)`; a `rule: null`/absent email renders `rule: none`; from/subject/body preserved.
- `generateBrief`: against a fake gmail + a store seeded with a rule and a capturing fake `writeBrief`, the `BriefEmail[]` handed to `writeBrief` carries the correct `rule` tag for the ruled sender and `null` for the un-ruled one.
- A light `writeBrief`-prompt assertion (or reuse `briefEmailBlock`) that the legend/weave guidance shipped.

## 8. Files

- **Modify:** `src/llm/provider.ts` (`BriefEmail.rule`), `src/notifier/brief.ts` (`generateBrief` deps + tag compute), `src/llm/gemini.ts` (`briefEmailBlock` + prompt legend), `app/api/poll/route.ts` (hoist store).
- **Test:** `tests/llm/brief-block.test.ts` (new, `briefEmailBlock`); extend/add a `generateBrief` threading test.
