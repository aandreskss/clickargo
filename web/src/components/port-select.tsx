"use client";

import { useState, useTransition } from "react";

export type Port = {
  code:         string;
  name:         string;
  country_code: string;
  type:         "sea" | "air" | "both";
  is_featured:  boolean;
};

// Búsqueda local — se llama desde server component para pasar initialPorts.
// Para queries más largas o si no hay coincidencias locales, se podría
// extender con una Server Action de búsqueda en BD.
function filterPorts(ports: Port[], q: string): Port[] {
  if (!q.trim()) return ports.filter((p) => p.is_featured);
  const term = q.toLowerCase();
  return ports.filter(
    (p) =>
      p.code.toLowerCase().includes(term) ||
      p.name.toLowerCase().includes(term) ||
      p.country_code.toLowerCase().includes(term),
  );
}

const FLAG: Record<string, string> = {
  DO:"🇩🇴", US:"🇺🇸", CN:"🇨🇳", PA:"🇵🇦", NL:"🇳🇱", BE:"🇧🇪",
  DE:"🇩🇪", ES:"🇪🇸", IT:"🇮🇹", BR:"🇧🇷", CO:"🇨🇴", MX:"🇲🇽",
  TR:"🇹🇷", KR:"🇰🇷",
};

export function PortSelect({
  name,
  label,
  defaultValue = "",
  initialPorts,
  required = true,
}: {
  name:         string;
  label:        string;
  defaultValue?: string;
  initialPorts: Port[];
  required?:    boolean;
}) {
  const [query, setQuery]   = useState("");
  const [open, setOpen]     = useState(false);
  const [selected, setSelected] = useState<Port | null>(
    () => initialPorts.find((p) => p.code === defaultValue) ?? null,
  );
  const [, startTransition] = useTransition();

  const results = filterPorts(initialPorts, query);

  function choose(port: Port) {
    startTransition(() => {
      setSelected(port);
      setQuery("");
      setOpen(false);
    });
  }

  return (
    <div className="relative block">
      <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">
        {label}{!required && <span className="font-normal text-[var(--color-text-muted)]"> (opcional)</span>}
      </span>

      {/* Campo oculto para el formulario */}
      <input type="hidden" name={name} value={selected?.code ?? ""} />

      {/* Input de búsqueda */}
      <input
        type="text"
        value={open ? query : (selected ? `[${selected.code}] ${selected.name}` : "")}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar por código o nombre…"
        required={required && !selected}
        className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-text)] outline-none transition focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-border-focus)]/20"
      />

      {/* Dropdown */}
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-[var(--color-text-muted)]">Sin resultados</li>
          )}
          {results.map((p) => (
            <li key={p.code}>
              <button
                type="button"
                onMouseDown={() => choose(p)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]">
                <span className="shrink-0 text-base">{FLAG[p.country_code] ?? "🌐"}</span>
                <span>
                  <span className="font-mono font-medium text-[var(--color-text)]">{p.code}</span>
                  {" — "}
                  <span className="text-[var(--color-text-muted)]">{p.name}</span>
                </span>
                {p.is_featured && (
                  <span className="ml-auto text-xs text-[var(--color-text-muted)]">frecuente</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
