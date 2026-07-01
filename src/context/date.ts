// A temporal anchor for the agent: the current date/time in the owner's timezone.
// Falls back to UTC if the timezone is missing or invalid.
export function dateContext(now: Date, tz: string): string {
  let zone = tz || "UTC";
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  };
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: zone }).format(now);
  } catch {
    zone = "UTC";
    formatted = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(now);
  }
  return `Today is ${formatted} (${zone}). Use this as "now" for any date reasoning.`;
}
