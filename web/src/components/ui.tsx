"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

// ─── Inputs ──────────────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-text)] outline-none transition focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-border-focus)]/20";

export function Field({ label, name, type = "text", placeholder, hint, required = true, minLength, defaultValue, inputMode, pattern }: {
  label: string; name: string; type?: string; placeholder?: string; hint?: string; required?: boolean; minLength?: number; defaultValue?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; pattern?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">
        {label}{!required && <span className="font-normal text-[var(--color-text-muted)]"> (opcional)</span>}
      </span>
      <input
        name={name} type={type} placeholder={placeholder} required={required} minLength={minLength}
        defaultValue={defaultValue} inputMode={inputMode} pattern={pattern} className={inputCls}
      />
      {hint && <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{hint}</span>}
    </label>
  );
}

export function Select({ label, name, options, defaultValue, required = true }: {
  label: string; name: string; options: readonly { value: string; label: string }[]; defaultValue?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">
        {label}{!required && <span className="font-normal text-[var(--color-text-muted)]"> (opcional)</span>}
      </span>
      <select name={name} defaultValue={defaultValue} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Textarea({ label, name, placeholder, hint, required = true, rows = 4, defaultValue }: {
  label: string; name: string; placeholder?: string; hint?: string; required?: boolean; rows?: number; defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">
        {label}{!required && <span className="font-normal text-[var(--color-text-muted)]"> (opcional)</span>}
      </span>
      <textarea
        name={name} placeholder={placeholder} required={required} rows={rows} defaultValue={defaultValue}
        className={`${inputCls} resize-y`}
      />
      {hint && <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{hint}</span>}
    </label>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonCls: Record<ButtonVariant, string> = {
  primary:   "bg-[var(--color-primary)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)]",
  secondary: "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]",
  ghost:     "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]",
  danger:    "text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]",
};

export function Button({ children, variant = "primary", type = "submit", disabled, title, onClick }: {
  children: ReactNode; variant?: ButtonVariant; type?: "submit" | "button" | "reset"; disabled?: boolean; title?: string; onClick?: () => void;
}) {
  return (
    <button type={type} disabled={disabled} title={title} onClick={onClick}
      className={`min-h-[44px] rounded-[var(--radius)] px-4 py-2.5 text-sm font-semibold transition ${buttonCls[variant]}${disabled ? " cursor-not-allowed opacity-50" : ""}`}>
      {children}
    </button>
  );
}

// ─── Notice ───────────────────────────────────────────────────────────────────

export function Notice({ error, info }: { error?: string; info?: string }) {
  if (!error && !info) return null;
  const cls = error
    ? "border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-text)]"
    : "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-text)]";
  return <p role="status" className={`rounded-[var(--radius)] border px-3 py-2 text-sm ${cls}`}>{error ?? info}</p>;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)] ${className}`}>
      {children}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

export function Table({ cols, children }: { cols: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[var(--color-border)] text-xs uppercase text-[var(--color-text-muted)]">
          <tr>{cols.map((c) => <th key={c} className="p-3 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, href }: { children: ReactNode; href?: string }) {
  const cls = "border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)] transition-colors";
  if (href) {
    return (
      <tr className={`${cls} cursor-pointer`} onClick={() => { window.location.href = href; }}>
        {children}
      </tr>
    );
  }
  return <tr className={cls}>{children}</tr>;
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`p-3 text-[var(--color-text)] ${className}`}>{children}</td>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export function Tabs({ tabs, active }: {
  tabs: { value: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t) => (
        <a key={t.value} href={t.href}
          className={`whitespace-nowrap rounded-[var(--radius-full)] px-3 py-1.5 text-sm font-medium transition ${
            t.value === active
              ? "bg-[var(--color-primary)] text-[var(--color-primary-text)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-muted)] ring-1 ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
          }`}>
          {t.label}
        </a>
      ))}
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ title, description, action, message }: {
  title?: string;
  description?: string;
  action?: { label: string; href: string };
  /** @deprecated Usar title + description */
  message?: string;
}) {
  const heading = title ?? message ?? "";
  return (
    <div className="p-10 text-center">
      <p className="text-base font-medium text-[var(--color-text)]">{heading}</p>
      {description && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>}
      {action && (
        <a href={action.href}
          className="mt-4 inline-block min-h-[44px] rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)]">
          {action.label}
        </a>
      )}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeColor = "default" | "success" | "warning" | "danger" | "info";

const badgeCls: Record<BadgeColor, string> = {
  default: "bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]",
  success: "bg-[var(--color-success-bg)] text-[var(--color-success-text)]",
  warning: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
  danger:  "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
  info:    "bg-[var(--color-info-bg)] text-[var(--color-info-text)]",
};

export function Badge({ children, color = "default" }: { children: ReactNode; color?: BadgeColor }) {
  return (
    <span className={`inline-flex items-center rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium ${badgeCls[color]}`}>
      {children}
    </span>
  );
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

export function Stepper({ steps, current }: {
  steps: { label: string; description?: string }[];
  current: number;
}) {
  return (
    <nav aria-label="Pasos">
      <ol className="flex items-start">
        {steps.map((step, i) => {
          const done   = i < current;
          const active = i === current;
          return (
            <li key={i} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1 text-center">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition ${
                  done   ? "bg-[var(--color-primary)] text-[var(--color-primary-text)]"
                  : active ? "ring-2 ring-[var(--color-primary)] text-[var(--color-primary)]"
                  :          "ring-2 ring-[var(--color-border)] text-[var(--color-text-muted)]"
                }`}>
                  {done ? "✓" : i + 1}
                </div>
                <span className={`max-w-[80px] text-xs font-medium leading-tight ${
                  active ? "text-[var(--color-primary)]"
                  : done  ? "text-[var(--color-text)]"
                  :         "text-[var(--color-text-muted)]"
                }`}>
                  {step.label}
                </span>
                {step.description && (
                  <span className="hidden max-w-[80px] text-xs text-[var(--color-text-muted)] sm:block">
                    {step.description}
                  </span>
                )}
              </div>
              {i < steps.length - 1 && (
                <div className={`mx-2 mb-5 h-0.5 flex-1 ${done ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── ConfirmUndo (toast con deshacer) ─────────────────────────────────────────

export function ConfirmUndo({ message, onUndo, onDismiss }: {
  message: string;
  onUndo: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  async function handleUndo() {
    setUndoing(true);
    await onUndo();
    onDismiss();
  }

  return (
    <div role="status"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-text)] px-5 py-3 text-sm shadow-[var(--shadow-card)]">
      <span className="text-[var(--color-primary-contrast)]">{message}</span>
      <button onClick={handleUndo} disabled={undoing}
        className="font-semibold text-[var(--color-primary-hover)] underline-offset-2 hover:underline disabled:opacity-60">
        {undoing ? "Deshaciendo…" : "Deshacer"}
      </button>
      <button onClick={onDismiss} aria-label="Cerrar"
        className="ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-primary-contrast)]">
        ✕
      </button>
    </div>
  );
}

// ─── CommandPalette (Ctrl+K) ─────────────────────────────────────────────────

export function CommandPalette({ onSearch }: { onSearch?: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24 px-4"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); onSearch?.(e.target.value); }}
          placeholder="Buscar clientes, cotizaciones, embarques…"
          className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3.5 text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
        />
        <div className="px-4 py-4 text-sm text-[var(--color-text-muted)]">
          {query ? "Sin resultados por ahora." : "Escribe para buscar en esta empresa."}
        </div>
        <div className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">
          <kbd className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono">Esc</kbd> para cerrar
        </div>
      </div>
    </div>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

export function Dialog({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string;
  children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="font-semibold text-[var(--color-text)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
