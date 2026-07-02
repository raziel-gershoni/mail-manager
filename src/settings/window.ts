// Timezone-aware digest-window predicate. Pure.
export function hourInZone(now: Date, timezone: string): number {
  const zone = timezone || "UTC";
  const read = (tz: string): number => {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now);
    const h = parseInt(s, 10);
    return h === 24 ? 0 : h; // some ICU builds render midnight as "24"
  };
  try { return read(zone); } catch { return read("UTC"); }
}

// True if `now` (in `timezone`) is within [startHour, endHour). Supports overnight
// wrap (start > end). startHour === endHour means a full-day (always-on) window.
export function isWithinDigestWindow(now: Date, timezone: string, startHour: number, endHour: number): boolean {
  const hour = hourInZone(now, timezone);
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}
