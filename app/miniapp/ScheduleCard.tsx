"use client";
// app/miniapp/ScheduleCard.tsx — the weekly brief schedule: a grouped summary to read,
// and a row per day to edit. Edits apply only on Save; Cancel discards them.
import { useEffect, useId, useRef, useState } from "react";
import { t, type Lang } from "../../src/i18n/index.js";
import { enableDay, formatHour, groupSchedule, isOvernight, type DayHours, type WeekSchedule } from "../../src/settings/schedule.js";
import { dayName, daysText, hoursText } from "../../src/settings/schedule-text.js";
import { Switch } from "./ui.js";

const FROM_HOURS = Array.from({ length: 24 }, (_, h) => h);   // 00:00–23:00
const TO_HOURS = Array.from({ length: 24 }, (_, h) => h + 1); // 01:00–24:00

export function ScheduleCard({ lang, schedule, onSave }: {
  lang: Lang;
  schedule: WeekSchedule;
  onSave: (next: WeekSchedule) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Array<DayHours | null> | null>(null); // null = view mode
  const [saving, setSaving] = useState(false);
  const idBase = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const editTitleRef = useRef<HTMLDivElement>(null);
  const isEditing = draft !== null;
  const wasEditing = useRef(isEditing);
  // The button that was focused (Edit, or Save/Cancel) disappears with the mode, so put
  // keyboard and screen-reader focus where the user now is instead of losing it to the page.
  useEffect(() => {
    if (wasEditing.current === isEditing) return;
    wasEditing.current = isEditing;
    (isEditing ? editTitleRef.current : editRef.current)?.focus();
  }, [isEditing]);
  const title = <span className="mm-row-label mm-strong">{t(lang, "mini_digest_window")}</span>;

  if (!draft) {
    return (
      <>
        <div className="mm-row">
          {title}
          <button ref={editRef} type="button" className="mm-link" onClick={() => setDraft(schedule.map(h => (h ? { from: h.from, to: h.to } : null)))}>
            {t(lang, "mini_edit")}
          </button>
        </div>
        {groupSchedule(schedule).map(g => <ViewLine key={g.days.join(",")} lang={lang} days={g.days} hours={g.hours} />)}
      </>
    );
  }

  const editing = draft;
  const anyOn = editing.some(h => h !== null);
  const setDay = (day: number, hours: DayHours | null) => setDraft(editing.map((h, d) => (d === day ? hours : h)));
  async function save() {
    if (!anyOn) return;
    setSaving(true);
    const ok = await onSave(editing);
    setSaving(false);
    if (ok) setDraft(null); // on failure the edits stay, and the toast says why
  }

  return (
    <>
      <div ref={editTitleRef} tabIndex={-1} className="mm-row mm-focus-target">{title}</div>
      {editing.map((h, day) => {
        const nameId = `${idBase}-day${day}`;
        return (
          <div key={day} className="mm-row mm-day">
            <label className="mm-day-toggle">
              <Switch checked={h !== null} disabled={saving}
                onChange={on => setDraft(on ? enableDay(editing, day) : editing.map((x, d) => (d === day ? null : x)))} />
              <span id={nameId} className="mm-day-name">{dayName(lang, day)}</span>
            </label>
            {h ? (
              <span className="mm-day-times" dir="ltr">
                <HourPicker hours={FROM_HOURS} value={h.from} labelledBy={nameId} disabled={saving} onChange={from => setDay(day, { from, to: h.to })} />
                <span className="mm-dash" aria-hidden="true">–</span>
                <HourPicker hours={TO_HOURS} value={h.to} labelledBy={nameId} disabled={saving} onChange={to => setDay(day, { from: h.from, to })} />
                {isOvernight(h) && <span className="mm-next">{t(lang, "mini_next_day")}</span>}
              </span>
            ) : (
              <span className="mm-off">{t(lang, "mini_day_off")}</span>
            )}
          </div>
        );
      })}
      {!anyOn && <p className="mm-row mm-note">{t(lang, "mini_schedule_need_day")}</p>}
      <div className="mm-row mm-sched-actions">
        <button type="button" className="mm-link" disabled={saving} onClick={() => setDraft(null)}>{t(lang, "mini_cancel")}</button>
        <button type="button" className="mm-link mm-strong" disabled={!anyOn || saving} onClick={save}>{t(lang, "mini_save")}</button>
      </div>
    </>
  );
}

function ViewLine({ lang, days, hours }: { lang: Lang; days: number[]; hours: DayHours | null }) {
  const h = hoursText(hours);
  return (
    <div className="mm-row">
      <span className="mm-row-label">{daysText(days, lang)}</span>
      {h.kind === "off" && <span className="mm-row-value mm-off">{t(lang, "mini_day_off")}</span>}
      {h.kind === "all_day" && <span className="mm-row-value mm-hours">{t(lang, "mini_all_day")}</span>}
      {h.kind === "range" && (
        <span className="mm-row-value mm-hours">
          <bdi dir="ltr" className="mm-num">{h.range}</bdi>
          {h.nextDay && <span className="mm-next">{t(lang, "mini_next_day")}</span>}
        </span>
      )}
    </div>
  );
}

function HourPicker({ hours, value, labelledBy, disabled, onChange }: {
  hours: number[];
  value: number;
  labelledBy: string;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <span className="mm-pill">
      <span aria-hidden="true">{formatHour(value)}</span>
      <select className="mm-picker-select" dir="ltr" value={value} disabled={disabled} aria-labelledby={labelledBy}
        onChange={e => onChange(Number(e.target.value))}>
        {hours.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
      </select>
    </span>
  );
}
