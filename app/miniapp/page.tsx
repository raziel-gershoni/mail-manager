"use client";
// app/miniapp/page.tsx — the settings screen inside Telegram.
import { useEffect, useState } from "react";
import { t, dir, type Lang } from "../../src/i18n/index.js";
import type { WeekSchedule } from "../../src/settings/schedule.js";
import { ScheduleCard } from "./ScheduleCard.js";
import { browserTimezones, timezoneOptions } from "./timezones.js";
import { initData, openLink, setupTelegramChrome } from "./telegram.js";
import { Card, Picker, Row, Section, Switch, Toast, type ToastState } from "./ui.js";

type View = {
  timezone: string; paused: boolean; language: Lang; schedule: WeekSchedule;
  gmail: { email: string | null; connected: boolean; needsReconnect: boolean };
  rules: Array<{ matchValue: string; scope: string; verdict: string; action: string }>;
  context: { totalTokens: number; systemTokens: number; summaryTokens: number; windowTokens: number; windowTurns: number; compactAtTokens: number };
  isOwner: boolean;
};

const SAVED_TOAST_MS = 2_500;
const LANGUAGES = [["en", "English"], ["he", "עברית"]] as const;
const fmt = (n: number) => n.toLocaleString();
const headers = () => ({ "x-telegram-init-data": initData(), "content-type": "application/json" });

export default function MiniApp() {
  const [view, setView] = useState<View | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [provId, setProvId] = useState("");
  const [provLang, setProvLang] = useState<Lang>("he");
  const [provBusy, setProvBusy] = useState(false);
  const [provUrl, setProvUrl] = useState("");
  const [provCopied, setProvCopied] = useState(false);
  const lang: Lang = view?.language ?? "en";

  useEffect(() => setupTelegramChrome(), []);
  useEffect(() => {
    void loadView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // "Saved" fades on its own; an error stays until the next action replaces it.
  useEffect(() => {
    if (toast?.kind !== "done") return;
    const id = setTimeout(() => setToast(null), SAVED_TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  function failed(text: string, what: string, err: unknown) {
    console.error(what, err);
    setToast({ text, kind: "error" });
  }

  async function loadView(): Promise<boolean> {
    try {
      const r = await fetch("/api/settings", { headers: headers() });
      if (!r.ok) throw new Error(`GET /api/settings ${r.status}`);
      setView(await r.json());
      return true;
    } catch (err) {
      console.error("settings load failed", err);
      setLoadFailed(true);
      return false;
    }
  }

  // Every setting saves through here. `l` is the language to speak in (a language change
  // answers in the new one).
  async function save(patch: Record<string, unknown>, l: Lang = lang): Promise<boolean> {
    setToast({ text: t(l, "mini_saving"), kind: "progress" });
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: headers(), body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(`POST /api/settings ${r.status} ${await r.text().catch(() => "")}`);
      setToast({ text: t(l, "mini_saved"), kind: "done" });
      return true;
    } catch (err) {
      failed(t(l, "mini_save_failed"), "settings save failed", err);
      return false;
    }
  }

  // Re-fetches, so every label and the layout direction switch over.
  async function saveLanguage(next: Lang) {
    if (await save({ language: next }, next)) await loadView();
  }
  async function saveTimezone(next: string) {
    if (await save({ timezone: next })) setView(v => v && { ...v, timezone: next });
  }
  // Optimistic: the switch flips at once and flips back if the save fails.
  async function setPaused(next: boolean) {
    setView(v => v && { ...v, paused: next });
    if (!(await save({ paused: next }))) setView(v => v && { ...v, paused: !next });
  }
  async function saveSchedule(next: WeekSchedule): Promise<boolean> {
    const ok = await save({ schedule: next });
    if (ok) setView(v => v && { ...v, schedule: next });
    return ok;
  }

  async function reconnect() {
    try {
      const r = await fetch("/api/settings/reconnect", { method: "POST", headers: headers() });
      if (!r.ok) throw new Error(`POST /api/settings/reconnect ${r.status}`);
      const { url } = await r.json();
      openLink(url);
    } catch (err) {
      failed(t(lang, "mini_reconnect_failed"), "reconnect failed", err);
    }
  }

  async function clearContext() {
    if (!window.confirm(t(lang, "mini_clear_confirm"))) return;
    setToast({ text: t(lang, "mini_clearing"), kind: "progress" });
    try {
      const r = await fetch("/api/settings/clear-context", { method: "POST", headers: headers() });
      if (!r.ok) throw new Error(`POST /api/settings/clear-context ${r.status}`);
      await loadView();
      setToast({ text: t(lang, "mini_cleared"), kind: "done" });
    } catch (err) {
      failed(t(lang, "mini_clear_failed"), "clear conversation failed", err);
    }
  }

  async function provision() {
    setProvUrl(""); setProvCopied(false);
    const idNum = Number(provId);
    if (!Number.isInteger(idNum) || provId.trim() === "") { setToast({ text: t(lang, "mini_provision_bad_id"), kind: "error" }); return; }
    setProvBusy(true);
    try {
      const r = await fetch("/api/admin/provision-user", { method: "POST", headers: headers(), body: JSON.stringify({ telegramUserId: idNum, language: provLang }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const text = data.error ? `${t(lang, "mini_provision_failed")}: ${data.error}` : t(lang, "mini_provision_failed");
        failed(text, "provision failed", new Error(`POST /api/admin/provision-user ${r.status}`));
        return;
      }
      setProvUrl(data.consentUrl);
      setToast(null);
    } catch (err) {
      failed(t(lang, "mini_provision_failed"), "provision failed", err);
    } finally {
      setProvBusy(false);
    }
  }
  async function copyProvUrl() {
    try { await navigator.clipboard.writeText(provUrl); setProvCopied(true); }
    catch (err) { console.error("clipboard write failed", err); }
  }

  if (!view) {
    return (
      <main className="mm" dir={dir(lang)} lang={lang}>
        <p className="mm-status" role={loadFailed ? "alert" : "status"}>{t(lang, loadFailed ? "mini_load_error" : "mini_loading")}</p>
      </main>
    );
  }

  const zones = timezoneOptions(view.timezone, browserTimezones());
  const ctx = view.context;
  const gmailStatus = view.gmail.connected
    ? (view.gmail.needsReconnect ? t(lang, "mini_needs_reconnect") : t(lang, "mini_connected"))
    : t(lang, "mini_not_connected");

  return (
    <main className="mm" dir={dir(lang)} lang={lang}>
      <h1 className="mm-title">{t(lang, "mini_settings")}</h1>

      <Section header={t(lang, "mini_section_briefs")} footer={t(lang, "mini_schedule_note")}>
        <Card>
          <ScheduleCard lang={lang} schedule={view.schedule} onSave={saveSchedule} />
        </Card>
        <Card>
          <label className="mm-row">
            <span className="mm-row-label">{t(lang, "mini_pause")}</span>
            <Switch checked={view.paused} onChange={setPaused} />
          </label>
        </Card>
      </Section>

      <Section header={t(lang, "mini_section_general")}>
        <Card>
          <label className="mm-row">
            <span className="mm-row-label">{t(lang, "mini_language")}</span>
            <Picker value={view.language} options={LANGUAGES} onChange={v => saveLanguage(v as Lang)} />
          </label>
          <label className="mm-row">
            <span className="mm-row-label">{t(lang, "mini_timezone")}</span>
            {zones
              ? <Picker value={view.timezone} options={zones.map(z => [z, z] as const)} ltr onChange={saveTimezone} />
              : <input className="mm-input mm-input-end" dir="ltr" defaultValue={view.timezone}
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== view.timezone) void saveTimezone(v); }} />}
          </label>
        </Card>
      </Section>

      <Section header={t(lang, "mini_gmail")}>
        <Card>
          <div className="mm-row">
            <span className="mm-row-label mm-ellipsis">{view.gmail.email ? <bdi>{view.gmail.email}</bdi> : t(lang, "mini_gmail")}</span>
            <span className={view.gmail.needsReconnect ? "mm-row-value mm-danger" : "mm-row-value"}>{gmailStatus}</span>
          </div>
          <button type="button" className="mm-row mm-action" onClick={reconnect}>{t(lang, "mini_reconnect")}</button>
        </Card>
      </Section>

      <Section>
        <Card>
          <details className="mm-details">
            <summary className="mm-row">
              <span className="mm-row-label">{t(lang, "mini_learned_rules")}</span>
              <span className="mm-row-value mm-num">{view.rules.length}</span>
              <span className="mm-chevron" aria-hidden="true" />
            </summary>
            {view.rules.length === 0
              ? <p className="mm-row mm-note">{t(lang, "mini_none_yet")}</p>
              : view.rules.map((r, i) => (
                <div key={i} className="mm-row">
                  <span className="mm-row-label">
                    <bdi className="mm-wrap">{r.matchValue}</bdi>
                    <span className="mm-row-sub">{[r.scope, r.verdict, r.action].filter(Boolean).join(" · ")}</span>
                  </span>
                </div>
              ))}
          </details>
        </Card>
      </Section>

      <Section header={t(lang, "mini_context")}
        footer={<><p>{t(lang, "mini_context_desc")}</p><p>{t(lang, "mini_context_note", { n: fmt(ctx.compactAtTokens) })}</p></>}>
        <Card>
          <Row label={t(lang, "mini_total")} value={<span className="mm-num mm-text">≈ {fmt(ctx.totalTokens)} {t(lang, "mini_tokens")}</span>} />
          <Row label={t(lang, "mini_system_rules")} value={<span className="mm-num">~{fmt(ctx.systemTokens)}</span>} />
          <Row label={t(lang, "mini_summary")} value={<span className="mm-num">~{fmt(ctx.summaryTokens)}</span>} />
          <Row label={`${t(lang, "mini_recent_turns")} (${ctx.windowTurns})`} value={<span className="mm-num">~{fmt(ctx.windowTokens)}</span>} />
        </Card>
      </Section>

      <Section footer={t(lang, "mini_clear_conversation_desc")}>
        <Card>
          <button type="button" className="mm-row mm-action mm-danger" onClick={clearContext}>{t(lang, "mini_clear_conversation")}</button>
        </Card>
      </Section>

      {view.isOwner && (
        <Section header={t(lang, "mini_provision_title")} footer={t(lang, "mini_provision_desc")}>
          <Card>
            <label className="mm-row">
              <span className="mm-row-label">{t(lang, "mini_provision_tgid")}</span>
              <input className="mm-input mm-input-end mm-num" inputMode="numeric" dir="ltr" value={provId}
                onChange={e => setProvId(e.target.value)} placeholder="123456789" />
            </label>
            <label className="mm-row">
              <span className="mm-row-label">{t(lang, "mini_language")}</span>
              <Picker value={provLang} options={[["he", "עברית"], ["en", "English"]]} onChange={v => setProvLang(v as Lang)} />
            </label>
            <button type="button" className="mm-row mm-action" onClick={provision} disabled={provBusy}>
              {provBusy ? t(lang, "mini_provision_creating") : t(lang, "mini_provision_create")}
            </button>
          </Card>
          {provUrl && (
            <Card>
              <div className="mm-row mm-stack">
                <span className="mm-note">{t(lang, "mini_provision_created")}</span>
                <input className="mm-input" dir="ltr" readOnly value={provUrl} onFocus={e => e.currentTarget.select()} />
              </div>
              <button type="button" className="mm-row mm-action" onClick={copyProvUrl}>
                {provCopied ? t(lang, "mini_provision_copied") : t(lang, "mini_provision_copy")}
              </button>
            </Card>
          )}
        </Section>
      )}

      <Toast toast={toast} />
    </main>
  );
}
