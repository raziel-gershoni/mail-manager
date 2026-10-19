// src/util/deadline.ts
// Stop WAITING for a call once the deadline passes. A Gemini call can take up to its 40s
// HTTP timeout, and the weekly work (spam check, second look) must end by its deadline to
// leave room for the send before Vercel's 300s cap. The abandoned call keeps running; its
// late settlement is swallowed.
export const TIMED_OUT = Symbol("timed-out");
const MAX_TIMER_MS = 2_147_483_647; // setTimeout fires at once past this

export async function beforeDeadline<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => {});
  try {
    return await Promise.race([p, new Promise<typeof TIMED_OUT>(r => { timer = setTimeout(() => r(TIMED_OUT), Math.min(Math.max(0, ms), MAX_TIMER_MS)); })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
