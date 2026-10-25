// app/miniapp/telegram.ts
// The few Telegram.WebApp calls the settings screen makes. Every call is guarded:
// outside Telegram, or on a client too old for a method, the screen still works and the
// failure is logged.
type WebApp = {
  initData?: string;
  colorScheme?: "light" | "dark";
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  openLink?: (url: string) => void;
};

function webApp(): WebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
}

function attempt(what: string, fn: () => void): void {
  try { fn(); } catch (err) { console.error(`telegram.${what} failed`, err); }
}

export function initData(): string {
  return webApp()?.initData ?? "";
}

// Telegram's header and the area behind the page take the page's own background, and
// native controls (pickers, inputs) follow Telegram's theme, which can differ from the
// device's.
function applyTheme(tg: WebApp): void {
  attempt("setHeaderColor", () => tg.setHeaderColor?.("secondary_bg_color"));
  attempt("setBackgroundColor", () => tg.setBackgroundColor?.("secondary_bg_color"));
  const scheme = tg.colorScheme;
  if (scheme) attempt("colorScheme", () => document.documentElement.style.setProperty("color-scheme", scheme));
}

// Call once on mount; returns the cleanup for the theme listener.
export function setupTelegramChrome(): () => void {
  const tg = webApp();
  if (!tg) return () => {};
  attempt("ready", () => tg.ready?.());
  attempt("expand", () => tg.expand?.());
  applyTheme(tg);
  const onTheme = () => applyTheme(tg);
  attempt("onEvent", () => tg.onEvent?.("themeChanged", onTheme));
  return () => attempt("offEvent", () => tg.offEvent?.("themeChanged", onTheme));
}

export function openLink(url: string): void {
  const tg = webApp();
  if (tg?.openLink) attempt("openLink", () => tg.openLink?.(url));
  else window.open(url, "_blank");
}
