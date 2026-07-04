export interface ActionItem { id: string; from: string; subject: string; action: "trash" | "archive" | "review" | "review_archive" | null; }
export interface CleanupBuckets { archive: string[]; trash: string[]; review: string[]; reviewArchive: string[]; undecided: { from: string; subject: string; ids: string[] }[]; capped: boolean; }

export function bucketByAction(items: ActionItem[], cap: number): CleanupBuckets {
  const archive: string[] = [], trash: string[] = [], review: string[] = [], reviewArchive: string[] = [];
  const undecidedMap = new Map<string, { from: string; subject: string; ids: string[] }>();
  let acted = 0, capped = false;
  for (const it of items) {
    if (it.action === null) {
      const g = undecidedMap.get(it.from) ?? { from: it.from, subject: it.subject, ids: [] };
      g.ids.push(it.id); undecidedMap.set(it.from, g);
      continue;
    }
    if (acted >= cap) { capped = true; continue; } // overflow left for the next run
    if (it.action === "archive") archive.push(it.id);
    else if (it.action === "review") review.push(it.id);                 // guarded trash: judged before trashing
    else if (it.action === "review_archive") reviewArchive.push(it.id);  // guarded archive: judged before archiving
    else trash.push(it.id);
    acted++;
  }
  return { archive, trash, review, reviewArchive, undecided: [...undecidedMap.values()], capped };
}
