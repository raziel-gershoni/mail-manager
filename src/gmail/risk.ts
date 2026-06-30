import type { EmailMeta } from "./headers.js";

export interface RiskSignals { bulk: boolean; hasListUnsubscribe: boolean; transactional: boolean; }

const TRANSACTIONAL = /\b(invoice|receipt|payment|order|refund|statement|verify|verification|password|security code|confirm)\b/i;

export function riskSignals(email: EmailMeta): RiskSignals {
  const h = email.headers;
  const hasListUnsubscribe = Boolean(h["list-unsubscribe"]);
  const precedence = (h["precedence"] ?? "").toLowerCase();
  const bulk = hasListUnsubscribe || precedence === "bulk" || precedence === "list" || precedence === "junk";
  const transactional = TRANSACTIONAL.test(email.subject) || TRANSACTIONAL.test(email.snippet);
  return { bulk, hasListUnsubscribe, transactional };
}
