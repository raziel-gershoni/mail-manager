"use client";
import { useEffect, useState } from "react";

type View = {
  timezone: string; digestStartHour: number; digestEndHour: number; paused: boolean;
  gmail: { email: string | null; connected: boolean; needsReconnect: boolean };
  rules: Array<{ matchValue: string; scope: string; verdict: string; action: string }>;
};

function initData(): string {
  if (typeof window === "undefined") return "";
  return (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? "";
}

const HOURS = Array.from({ length: 25 }, (_, i) => i); // 0..24

export default function MiniApp() {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<string>("Loading…");
  const headers = { "x-telegram-init-data": initData(), "content-type": "application/json" };

  useEffect(() => {
    fetch("/api/settings", { headers })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((v: View) => { setView(v); setStatus(""); })
      .catch(() => setStatus("Couldn’t load settings. Open this from the bot’s menu button."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<View>) {
    setStatus("Saving…");
    try {
      const r = await fetch("/api/settings", { method: "POST", headers, body: JSON.stringify(patch) });
      setStatus(r.ok ? "Saved ✓" : "Save failed");
    } catch { setStatus("Save failed"); }
  }
  async function reconnect() {
    try {
      const r = await fetch("/api/settings/reconnect", { method: "POST", headers });
      if (!r.ok) { setStatus("Reconnect failed"); return; }
      const { url } = await r.json();
      const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } }).Telegram?.WebApp;
      if (tg?.openLink) tg.openLink(url); else window.open(url, "_blank");
    } catch { setStatus("Reconnect failed"); }
  }

  if (!view) return <main style={S.main}><p>{status}</p></main>;

  return (
    <main style={S.main}>
      <h2 style={S.h}>Settings</h2>

      <label style={S.row}>Timezone
        <input style={S.input} defaultValue={view.timezone}
          onBlur={e => save({ timezone: e.target.value })} />
      </label>

      <div style={S.row}>Digest window
        <span>
          <select defaultValue={view.digestStartHour} onChange={e => save({ digestStartHour: Number(e.target.value) } as Partial<View>)}>
            {HOURS.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
          {" – "}
          <select defaultValue={view.digestEndHour} onChange={e => save({ digestEndHour: Number(e.target.value) } as Partial<View>)}>
            {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </span>
      </div>

      <label style={S.row}>Pause briefs
        <input type="checkbox" defaultChecked={view.paused} onChange={e => save({ paused: e.target.checked })} />
      </label>

      <div style={S.row}>Gmail
        <span>
          {view.gmail.connected ? (view.gmail.needsReconnect ? "⚠️ needs reconnect" : `✅ ${view.gmail.email}`) : "not connected"}
          {" "}<button style={S.btn} onClick={reconnect}>Reconnect</button>
        </span>
      </div>

      <h3 style={S.h}>Learned rules</h3>
      {view.rules.length === 0 ? <p style={S.dim}>None yet.</p> : (
        <ul style={S.list}>
          {view.rules.map((r, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              <div style={{ overflowWrap: "anywhere" }}>{r.matchValue}</div>
              <div style={S.dim}>{[r.scope, r.verdict, r.action].filter(Boolean).join(" · ")}</div>
            </li>
          ))}
        </ul>
      )}

      <p style={S.dim}>{status}</p>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", padding: 16, color: "var(--tg-theme-text-color, #000)", background: "var(--tg-theme-bg-color, #fff)", maxWidth: 480 },
  h: { margin: "12px 0 8px" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--tg-theme-hint-color, #eee)" },
  input: { flex: 1, maxWidth: 200 },
  btn: { padding: "4px 10px", background: "var(--tg-theme-button-color, #2ea6ff)", color: "var(--tg-theme-button-text-color, #fff)", border: "none", borderRadius: 6, cursor: "pointer" },
  list: { paddingLeft: 18 },
  dim: { color: "var(--tg-theme-hint-color, #888)", fontSize: 13 },
};
