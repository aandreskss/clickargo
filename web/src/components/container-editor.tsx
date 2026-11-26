"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { validateISO6346 } from "@/lib/container-validation";

type Container = {
  container_number: string;
  container_type_id: string;
  seal_number: string;
  weight_kg: string;
  notes: string;
};

type ContainerType = { code: string; name: string };

const EMPTY: Container = {
  container_number:  "",
  container_type_id: "",
  seal_number:       "",
  weight_kg:         "",
  notes:             "",
};

const cls =
  "w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-text)] outline-none transition focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-border-focus)]/20";

function LabeledInput({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
      />
    </label>
  );
}

function LabeledSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ContainerEditor({
  initialContainers,
  containerTypes = [],
}: {
  initialContainers: Partial<Container>[];
  containerTypes?: ContainerType[];
}) {
  const [items, setItems] = useState<Container[]>(
    initialContainers.length > 0
      ? initialContainers.map((c) => ({ ...EMPTY, ...c }))
      : []
  );

  const add    = () => setItems((prev) => [...prev, { ...EMPTY }]);
  const remove = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof Container, val: string) =>
    setItems((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));

  const typeOptions = [
    { value: "", label: "— Tipo —" },
    ...containerTypes.map((t) => ({ value: t.code, label: `${t.code} — ${t.name}` })),
  ];

  return (
    <div className="space-y-3">
      {/* Hidden input serializa el estado al formulario server-side */}
      <input type="hidden" name="containers" value={JSON.stringify(items)} />

      {items.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Sin contenedores. Haz clic en &ldquo;Agregar&rdquo; para añadir uno.
        </p>
      )}

      {items.map((c, i) => {
        const validation = c.container_number ? validateISO6346(c.container_number) : null;
        return (
          <div
            key={i}
            className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text)]">Contenedor {i + 1}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-xs text-[var(--color-error)] hover:underline"
              >
                Quitar
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <LabeledInput
                  label="Número"
                  value={c.container_number}
                  onChange={(v) => update(i, "container_number", v)}
                  placeholder="MSCU1234566"
                />
                {validation && !validation.valid && (
                  <p className="mt-1 text-xs text-[var(--color-warning)]">{validation.reason}</p>
                )}
              </div>
              <LabeledSelect
                label="Tipo"
                value={c.container_type_id}
                onChange={(v) => update(i, "container_type_id", v)}
                options={typeOptions}
              />
              <LabeledInput
                label="Sello"
                value={c.seal_number}
                onChange={(v) => update(i, "seal_number", v)}
              />
              <LabeledInput
                label="Peso (kg)"
                value={c.weight_kg}
                type="number"
                onChange={(v) => update(i, "weight_kg", v)}
              />
            </div>
          </div>
        );
      })}

      <Button type="button" variant="ghost" onClick={add}>
        + Agregar contenedor
      </Button>
    </div>
  );
}