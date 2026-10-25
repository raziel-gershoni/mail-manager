import { describe, it, expect, vi, afterEach } from "vitest";
import { initData, setupTelegramChrome } from "../../app/miniapp/telegram.js";

const g = globalThis as unknown as Record<string, unknown>;
afterEach(() => { delete g.window; delete g.document; vi.restoreAllMocks(); });

function inTelegram(webApp: Record<string, unknown>): Record<string, string> {
  const props: Record<string, string> = {};
  g.document = { documentElement: { style: { setProperty: (k: string, v: string) => { props[k] = v; } } } };
  g.window = { Telegram: { WebApp: webApp } };
  return props;
}

describe("setupTelegramChrome", () => {
  it("does nothing outside Telegram", () => {
    g.window = {};
    expect(() => setupTelegramChrome()()).not.toThrow();
  });
  it("readies and expands the app, matches its header and background to the page, and again on a theme change", () => {
    const calls: string[] = [];
    let onTheme: (() => void) | undefined;
    const props = inTelegram({
      colorScheme: "dark",
      ready: () => calls.push("ready"),
      expand: () => calls.push("expand"),
      setHeaderColor: (c: string) => calls.push(`header:${c}`),
      setBackgroundColor: (c: string) => calls.push(`bg:${c}`),
      onEvent: (e: string, cb: () => void) => { if (e === "themeChanged") onTheme = cb; },
      offEvent: () => calls.push("off"),
    });
    const cleanup = setupTelegramChrome();
    expect(calls).toEqual(["ready", "expand", "header:secondary_bg_color", "bg:secondary_bg_color"]);
    expect(props["color-scheme"]).toBe("dark");
    onTheme!();
    expect(calls.slice(4)).toEqual(["header:secondary_bg_color", "bg:secondary_bg_color"]);
    cleanup();
    expect(calls.at(-1)).toBe("off");
  });
  it("keeps going when a client throws on a method, and logs each failure", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    inTelegram({
      ready: () => calls.push("ready"),
      expand: () => { throw new Error("unsupported"); },
      setHeaderColor: () => { throw new Error("unsupported"); },
      setBackgroundColor: () => calls.push("bg"),
    });
    expect(() => setupTelegramChrome()).not.toThrow();
    expect(calls).toEqual(["ready", "bg"]);
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe("initData", () => {
  it("is empty outside Telegram", () => {
    expect(initData()).toBe("");
  });
});
