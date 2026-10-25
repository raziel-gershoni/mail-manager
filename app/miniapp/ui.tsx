// app/miniapp/ui.tsx — the settings screen's building blocks, styled by miniapp.css.
import type { ReactNode } from "react";

export function Section({ header, footer, children }: { header?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="mm-section">
      {header && <h2 className="mm-section-header">{header}</h2>}
      {children}
      {footer && <div className="mm-section-footer">{footer}</div>}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="mm-card">{children}</div>;
}

// A label at the start, its value at the end.
export function Row({ label, value }: { label: ReactNode; value?: ReactNode }) {
  return (
    <div className="mm-row">
      <span className="mm-row-label">{label}</span>
      {value !== undefined && <span className="mm-row-value">{value}</span>}
    </div>
  );
}

// A checkbox with role="switch" over a drawn track. Put it inside a <label> so the
// label's text is its name and the whole label is its hit area.
export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <span className="mm-switch">
      <input type="checkbox" role="switch" className="mm-switch-input" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)} />
      <span className="mm-switch-track" aria-hidden="true" />
    </span>
  );
}

// A select drawn as a value with a chevron; the native select lies invisibly on top, so
// a tap opens the platform's own picker. Inside a <label>, the label names it.
export function Picker({ value, options, onChange, ltr, disabled }: {
  value: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  onChange: (next: string) => void;
  ltr?: boolean;
  disabled?: boolean;
}) {
  const current = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <span className="mm-picker">
      <span className="mm-picker-value" dir={ltr ? "ltr" : undefined} aria-hidden="true">{current}</span>
      <select className="mm-picker-select" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </span>
  );
}

export interface ToastState { text: string; kind: "progress" | "done" | "error" }

// One visible toast, plus two live regions that are always in the DOM: screen readers
// announce text that appears in an existing region, but not reliably when a region's role
// changes, so progress/done and errors each get their own.
export function Toast({ toast }: { toast: ToastState | null }) {
  const error = toast?.kind === "error";
  return (
    <>
      <div className="mm-sr-only" role="status">{toast && !error ? toast.text : ""}</div>
      <div className="mm-sr-only" role="alert">{toast && error ? toast.text : ""}</div>
      <div className="mm-toast" aria-hidden="true">
        {toast && <div key={`${toast.kind}:${toast.text}`} className={error ? "mm-toast-msg mm-toast-error" : "mm-toast-msg"}>{toast.text}</div>}
      </div>
    </>
  );
}
