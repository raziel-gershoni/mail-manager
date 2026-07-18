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
