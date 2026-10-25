// app/miniapp/timezones.ts
// The timezone choices: every IANA zone the browser knows, with the user's current one
// first (added when the list lacks it; V8 leaves out "UTC"). null when the browser can't
// list zones, so the screen falls back to a text field.
export function timezoneOptions(current: string, known: readonly string[] | undefined): string[] | null {
  if (!known || known.length === 0) return null;
  return [current, ...known.filter(z => z !== current)];
}

export function browserTimezones(): string[] | undefined {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
  } catch (err) {
    console.error("timezone list unavailable", err);
    return undefined;
  }
}
