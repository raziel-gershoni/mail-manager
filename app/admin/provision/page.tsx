"use client";
// Owner-only admin page to provision a second user. Nothing secret lives in this
// page — the SETUP_SECRET is typed by the owner and validated server-side by
// /api/admin/provision-user, which 403s without it. The key is remembered in this
// browser's localStorage for convenience (owner's own admin machine).
import { useEffect, useState } from "react";

const KEY_LS = "mm_setup_key";

export default function ProvisionAdmin() {
  const [key, setKey] = useState("");
  const [telegramUserId, setTelegramUserId] = useState("");
  const [language, setLanguage] = useState<"he" | "en">("he");
  const [busy, setBusy] = useState(false);
  const [consentUrl, setConsentUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { setKey(localStorage.getItem(KEY_LS) ?? ""); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setConsentUrl(""); setCopied(false);
    const idNum = Number(telegramUserId);
    if (!Number.isInteger(idNum)) { setError("Telegram user ID must be a whole number."); return; }
    localStorage.setItem(KEY_LS, key);
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/provision-user?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ telegramUserId: idNum, language }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ? `${r.status}: ${data.error}` : `Request failed (${r.status})`); return; }
      setConsentUrl(data.consentUrl);
    } catch { setError("Network error."); }
    finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(consentUrl); setCopied(true); } catch { /* clipboard blocked */ }
  }

  return (
    <main style={S.main}>
      <h2 style={S.h}>Provision a user</h2>
      <p style={S.dim}>Creates the user + Telegram link and returns a Google consent link. Send that link to the person — they connect their own Gmail (valid 60 min).</p>

      <form onSubmit={submit}>
        <label style={S.row}>Setup key
          <input style={S.input} type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" />
        </label>
        <label style={S.row}>Telegram user ID
          <input style={S.input} inputMode="numeric" value={telegramUserId} onChange={e => setTelegramUserId(e.target.value)}
            placeholder="e.g. 762715667" />
        </label>
        <label style={S.row}>Language
          <select value={language} onChange={e => setLanguage(e.target.value as "he" | "en")}>
            <option value="he">עברית (he)</option>
            <option value="en">English (en)</option>
          </select>
        </label>
        <button style={S.btn} type="submit" disabled={busy}>{busy ? "Creating…" : "Create consent link"}</button>
      </form>

      {error && <p style={S.err}>{error}</p>}
      {consentUrl && (
        <div style={{ marginTop: 16 }}>
          <p style={S.dim}>✅ Created. Send this link to the user:</p>
          <input style={{ ...S.input, width: "100%", maxWidth: "none" }} readOnly value={consentUrl}
            onFocus={e => e.currentTarget.select()} />
          <button style={{ ...S.btn, marginTop: 8 }} type="button" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
        </div>
      )}
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", padding: 20, maxWidth: 520, margin: "0 auto", color: "#111" },
  h: { margin: "0 0 8px" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #eee" },
  input: { flex: 1, maxWidth: 260, padding: "6px 8px", fontSize: 15 },
  btn: { marginTop: 14, padding: "8px 16px", background: "#2ea6ff", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 15 },
  dim: { color: "#666", fontSize: 13, lineHeight: 1.5 },
  err: { color: "#c00", fontSize: 14, marginTop: 12 },
};
