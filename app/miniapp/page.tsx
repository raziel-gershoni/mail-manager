"use client";
import { useEffect, useState } from "react";
import { t, dir, type Lang } from "../../src/i18n/index.js";

type View = {
  timezone: string; digestStartHour: number; digestEndHour: number; paused: boolean; language: Lang;
  gmail: { email: string | null; connected: boolean; needsReconnect: boolean };
  rules: Array<{ matchValue: string; scope: string; verdict: string; action: string }>;
  context: { totalTokens: number; systemTokens: number; summaryTokens: number; windowTokens: number; windowTurns: number; compactAtTokens: number };
};

const fmt = (n: number) => n.toLocaleString();

function initData(): string {
  if (typeof window === "undefined") return "";
  return (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? "";
}

const HOURS = Array.from({ length: 25 }, (_, i) => i); // 0..24

export default function MiniApp() {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<string>(t("en", "mini_loading"));
  const headers = { "x-telegram-init-data": initData(), "content-type": "application/json" };
  const lang: Lang = view?.language ?? "en";

  async function loadView() {
    try {
      const r = await fetch("/api/settings", { headers });
      if (!r.ok) throw new Error(String(r.status));
      setView(await r.json());
      setStatus("");
    } catch { setStatus(t(lang, "mini_load_error")); }
  }
  useEffect(() => {
    loadView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<View>) {
    setStatus(t(lang, "mini_saving"));
    try {
      const r = await fetch("/api/settings", { method: "POST", headers, body: JSON.stringify(patch) });
      setStatus(r.ok ? t(lang, "mini_saved") : t(lang, "mini_save_failed"));
    } catch { setStatus(t(lang, "mini_save_failed")); }
  }
  // Changing the language re-fetches so every label + the layout direction update.
  async function saveLanguage(next: Lang) {
    setStatus(t(next, "mini_saving"));
    try {
      const r = await fetch("/api/settings", { method: "POST", headers, body: JSON.stringify({ language: next }) });
      if (r.ok) { await loadView(); setStatus(t(next, "mini_saved")); }
      else setStatus(t(lang, "mini_save_failed"));
    } catch { setStatus(t(lang, "mini_save_failed")); }
  }
  async function reconnect() {
    try {
      const r = await fetch("/api/settings/reconnect", { method: "POST", headers });
      if (!r.ok) { setStatus(t(lang, "mini_reconnect_failed")); return; }
      const { url } = await r.json();
      const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } }).Telegram?.WebApp;
      if (tg?.openLink) tg.openLink(url); else window.open(url, "_blank");
    } catch { setStatus(t(lang, "mini_reconnect_failed")); }
  }
  async function clearContext() {
    if (!window.confirm(t(lang, "mini_clear_confirm"))) return;
    setStatus(t(lang, "mini_clearing"));
    try {
      const r = await fetch("/api/settings/clear-context", { method: "POST", headers });
      if (!r.ok) { setStatus(t(lang, "mini_clear_failed")); return; }
      await loadView();
      setStatus(t(lang, "mini_cleared"));
    } catch { setStatus(t(lang, "mini_clear_failed")); }
  }

  if (!view) return <main dir={dir(lang)} style={S.main}><p>{status}</p></main>;

  return (
    <main dir={dir(lang)} style={S.main}>
      <h2 style={S.h}>{t(lang, "mini_settings")}</h2>

      <label style={S.row}>{t(lang, "mini_language")}
        <select value={view.language} onChange={e => saveLanguage(e.target.value as Lang)}>
          <option value="en">English</option>
          <option value="he">עברית</option>
        </select>
      </label>

      <label style={S.row}>{t(lang, "mini_timezone")}
        <input style={S.input} defaultValue={view.timezone} dir="ltr"
          onBlur={e => save({ timezone: e.target.value })} />
      </label>

      <div style={S.row}>{t(lang, "mini_digest_window")}
        <span dir="ltr">
          <select defaultValue={view.digestStartHour} onChange={e => save({ digestStartHour: Number(e.target.value) } as Partial<View>)}>
            {HOURS.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
          {" – "}
          <select defaultValue={view.digestEndHour} onChange={e => save({ digestEndHour: Number(e.target.value) } as Partial<View>)}>
            {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </span>
      </div>

      <label style={S.row}>{t(lang, "mini_pause")}
        <input type="checkbox" defaultChecked={view.paused} onChange={e => save({ paused: e.target.checked })} />
      </label>

      <div style={S.row}>{t(lang, "mini_gmail")}
        <span>
          {view.gmail.connected
            ? (view.gmail.needsReconnect ? t(lang, "mini_needs_reconnect") : <span dir="auto">✅ {view.gmail.email}</span>)
            : t(lang, "mini_not_connected")}
          {" "}<button style={S.btn} onClick={reconnect}>{t(lang, "mini_reconnect")}</button>
        </span>
      </div>

      <details style={S.details}>
        <summary style={S.summary}>{t(lang, "mini_learned_rules")} ({view.rules.length})</summary>
        {view.rules.length === 0 ? <p style={S.dim}>{t(lang, "mini_none_yet")}</p> : (
          <ul style={S.list}>
            {view.rules.map((r, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                <div dir="auto" style={{ overflowWrap: "anywhere" }}>{r.matchValue}</div>
                <div style={S.dim}>{[r.scope, r.verdict, r.action].filter(Boolean).join(" · ")}</div>
              </li>
            ))}
          </ul>
        )}
      </details>

      <h3 style={S.h}>{t(lang, "mini_context")}</h3>
      <p style={S.dim}>{t(lang, "mini_context_desc")}</p>
      <ul style={S.list}>
        <li>{t(lang, "mini_total")}: <b>≈ {fmt(view.context.totalTokens)}</b> {t(lang, "mini_tokens")}</li>
        <li style={S.dim}>{t(lang, "mini_system_rules")}: ~{fmt(view.context.systemTokens)}</li>
        <li style={S.dim}>{t(lang, "mini_summary")}: ~{fmt(view.context.summaryTokens)}</li>
        <li style={S.dim}>{t(lang, "mini_recent_turns")} ({view.context.windowTurns}): ~{fmt(view.context.windowTokens)}</li>
      </ul>
      <p style={S.dim}>{t(lang, "mini_context_note", { n: fmt(view.context.compactAtTokens) })}</p>
      <button style={S.btn} onClick={clearContext}>{t(lang, "mini_clear_conversation")}</button>
      <p style={S.dim}>{t(lang, "mini_clear_conversation_desc")}</p>

      <p style={S.dim}>{status}</p>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", padding: 16, color: "var(--tg-theme-text-color, #000)", background: "var(--tg-theme-bg-color, #fff)", maxWidth: 480, textAlign: "start" },
  h: { margin: "12px 0 8px" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--tg-theme-hint-color, #eee)" },
  input: { flex: 1, maxWidth: 200 },
  btn: { padding: "4px 10px", background: "var(--tg-theme-button-color, #2ea6ff)", color: "var(--tg-theme-button-text-color, #fff)", border: "none", borderRadius: 6, cursor: "pointer" },
  list: { paddingInlineStart: 18 },
  dim: { color: "var(--tg-theme-hint-color, #888)", fontSize: 13 },
  details: { margin: "12px 0", borderBottom: "1px solid var(--tg-theme-hint-color, #eee)", paddingBottom: 8 },
  summary: { margin: "8px 0", fontSize: "1.05em", fontWeight: 600, cursor: "pointer" },
};
