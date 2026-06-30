import type { LLMProvider, TrashCandidate } from "../llm/provider.js";

export const TRASH_CAP = 200;
export interface SetAsideItem { id: string; reason: string; }
export interface VetResult { autoTrash: string[]; setAside: SetAsideItem[]; capped: boolean; }

export async function vetTrashSet(
  candidates: TrashCandidate[],
  deps: { llm: LLMProvider; cap?: number },
): Promise<VetResult> {
  const cap = deps.cap ?? TRASH_CAP;
  const setAside: SetAsideItem[] = [];
  const eligible: TrashCandidate[] = [];
  for (const c of candidates) {
    if (!c.bulk) setAside.push({ id: c.id, reason: "not bulk" });
    else if (c.transactional) setAside.push({ id: c.id, reason: "transactional" });
    else eligible.push(c);
  }
  const verdicts = await deps.llm.reviewTrash(eligible);
  const rescued = new Map(verdicts.filter(v => v.keep).map(v => [v.id, v.reason]));
  const survivors: string[] = [];
  for (const c of eligible) {
    if (rescued.has(c.id)) setAside.push({ id: c.id, reason: `rescued: ${rescued.get(c.id) || "valuable"}` });
    else survivors.push(c.id);
  }
  let capped = false;
  let autoTrash = survivors;
  if (survivors.length > cap) {
    autoTrash = survivors.slice(0, cap);
    for (const id of survivors.slice(cap)) setAside.push({ id, reason: "exceeds per-action cap" });
    capped = true;
  }
  return { autoTrash, setAside, capped };
}
