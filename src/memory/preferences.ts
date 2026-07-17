// src/memory/preferences.ts
// Pure validation + sanitization for standing preferences. A preference's text is
// injected verbatim into the poll classifier's system prompt on EVERY message, so it
// is both a recurring per-message token cost and a prompt-injection surface.

export const PREF_MAX_CHARS = 200;
export const PREF_MAX = 20;

export type PrefAction = "trash" | "archive";
export interface PreferenceValue { key: string; description: string; verdict: "important" | "unimportant"; action: PrefAction | null; }
export type PreferenceValidation = { ok: true; value: PreferenceValue } | { ok: false; error: string };

const KEY_RE = /^[a-z0-9-]{1,32}$/;

export function normalizeKey(raw: string): string {
  return String(raw ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-").slice(0, 32).replace(/^-+|-+$/g, "");
}

// Collapse ALL whitespace (including U+0085 NEL) and strip control chars: a preference
// renders as ONE "- [key] text" line, so an embedded newline would let its text forge
// additional prompt lines and impersonate instructions. U+0085 is not matched by \s but
// can serve as a line terminator in some pipelines, so it is normalized to a space.
//
// Written with charCodeAt rather than a control-char regex range on purpose: it is
// escape-free and unambiguous. Process: convert code 133 (NEL) to space so it collapses
// with other whitespace, then drop all remaining control chars (C0: 0-31, DEL: 127, C1: 128-159).
export function sanitizeDescription(raw: string): string {
  let str = String(raw ?? "");

  // Convert U+0085 (NEL, code 133) to space so it participates in whitespace collapsing
  let converted = "";
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 133) {
      converted += " ";
    } else {
      converted += str[i];
    }
  }

  // Collapse all consecutive whitespace to a single space
  const spaced = converted.replace(/\s+/g, " ");

  // Filter: keep only chars >= 32 (printable) except DEL (127) and C1 block (128-159)
  const filtered = [...spaced].filter(ch => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c !== 127 && (c < 128 || c > 159);
  }).join("");

  return filtered.trim();
}

export function validatePreference(
  input: { key: string; description: string; verdict: string; action?: string | null },
  existingKeys: string[],
): PreferenceValidation {
  const key = normalizeKey(input.key);
  if (!KEY_RE.test(key)) return { ok: false, error: "invalid key: use 1-32 chars of a-z, 0-9, -" };
  const description = sanitizeDescription(input.description);
  if (!description) return { ok: false, error: "description is empty" };
  if (description.length > PREF_MAX_CHARS) return { ok: false, error: `description too long (max ${PREF_MAX_CHARS} chars)` };
  if (input.verdict !== "important" && input.verdict !== "unimportant") return { ok: false, error: "verdict must be important or unimportant" };
  const action = input.action ?? null;
  if (action !== null && action !== "trash" && action !== "archive") return { ok: false, error: "action must be trash or archive" };
  // Only a NEW key consumes cap space; re-teaching an existing preference at the cap is fine.
  if (!existingKeys.includes(key) && existingKeys.length >= PREF_MAX) return { ok: false, error: `too many preferences (max ${PREF_MAX})` };
  return { ok: true, value: { key, description, verdict: input.verdict, action } };
}
