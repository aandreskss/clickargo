"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui";
import { QUOTE_SERVICE_TYPES } from "@/lib/field-packs";
import { calcTotals, calcMargin, fmtMoney } from "@/lib/quote-math";

type Account = { id: string; name: string };

type LineState = {
  key: string;
  service: string;
  qty: string;
  unit_price: string;
  taxable: boolean;
  cost: string;
};

type QuoteFormProps = {
  action: (formData: FormData) => Promise<void>;
  accounts: Account[];
  canSeeCosts: boolean;
  defaultAccountId?: string;
  defaultServiceType?: string;
  defaultOrigin?: string;
  defaultDestination?: string;
  defaultCurrency?: string;
  defaultNotes?: string;
  defaultValidUntil?: string;
  defaultLines?: LineState[];
  quoteId?: string;
  submitLabel?: string;
};

const CURRENCIES = ["USD", "DOP", "EUR"];

function emptyLine(key: string): LineState {
  return { key, service: "", qty: "1", unit_price: "", taxable: true, cost: "" };
}

let keyCounter = 0;
const nextKey = () => `line-${++keyCounter}`;

export function QuoteForm({
  action,
  accounts,
  canSeeCosts,
  defaultAccountId = "",
  defaultServiceType = "mar_import",
  defaultOrigin = "",
  defaultDestination = "",
  defaultCurrency = "USD",
  defaultNotes = "",
  defaultValidUntil = "",
  defaultLines,
  quoteId,
  submitLabel = "Guardar cotización",
}: QuoteFormProps) {
  const [lines, setLines] = useState<LineState[]>(
    defaultLines ?? [emptyLine(nextKey())]
  );
  const [currency, setCurrency] = useState(defaultCurrency);

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, emptyLine(nextKey())]);
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const updateLine = useCallback((key: string, field: keyof LineState, value: string | boolean) => {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, [field]: value } : l));
  }, []);

  // Calcular totales para preview
  const mathLines = lines.map((l) => ({
    qty:        parseFloat(l.qty)        || 0,
    unit_price: parseFloat(l.unit_price) || 0,
    taxable:    l.taxable,
  }));
  const totals = calcTotals(mathLines);
  const totalCost = canSeeCosts
    ? lines.reduce((s, l) => s + (parseFloat(l.cost) || 0), 0)
    : 0;
  const costSummary = canSeeCosts ? calcMargin(totals.total, totalCost) : null;

  // Serializar para hidden inputs
  const linesJson = JSON.stringify(
    lines.map((l, i) => ({
      service:    l.service,
      qty:        parseFloat(l.qty)        || 0,
      unit_price: parseFloat(l.unit_price) || 0,
      currency,
      taxable:    l.taxable,
      sort_order: i,
    }))
  );

  const costsJson = canSeeCosts
    ? JSON.stringify(
        lines
          .map((l, i) => {
            const cost = parseFloat(l.cost);
            if (!cost && cost !== 0) return null;
            return { line_index: i, cost: cost || 0, currency };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null)
      )
    : "[]";

  const inputCls = "w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-border-focus)]/20";
  const labelCls = "block text-sm font-medium text-[var(--color-text)] mb-1";
  const mutedCls = "text-[var(--color-text-muted)]";

  return (
    <form action={action} className="space-y-6">
      {quoteId && <input type="hidden" name="id" value={quoteId} />}
      <input type="hidden" name="lines" value={linesJson} />
      {canSeeCosts && <input type="hidden" name="line_costs" value={costsJson} />}

      {/* ── Datos principales ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelCls}>Cliente <span className="text-[var(--color-error-text)]">*</span></span>
          <select name="account_id" defaultValue={defaultAccountId} required className={inputCls}>
            <option value="">— Selecciona un cliente —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Tipo de servicio <span className="text-[var(--color-error-text)]">*</span></span>
          <select name="service_type" defaultValue={defaultServiceType} required className={inputCls}>
            {QUOTE_SERVICE_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Moneda</span>
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Origen <span className={`font-normal ${mutedCls}`}>(opcional)</span></span>
          <input name="origin" type="text" defaultValue={defaultOrigin} placeholder="Puerto / ciudad" className={inputCls} />
        </label>

        <label className="block">
          <span className={labelCls}>Destino <span className={`font-normal ${mutedCls}`}>(opcional)</span></span>
          <input name="destination" type="text" defaultValue={defaultDestination} placeholder="Puerto / ciudad" className={inputCls} />
        </label>

        <label className="block">
          <span className={labelCls}>Válida hasta <span className={`font-normal ${mutedCls}`}>(opcional)</span></span>
          <input name="valid_until" type="date" defaultValue={defaultValidUntil} className={inputCls} />
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>Notas internas <span className={`font-normal ${mutedCls}`}>(opcional)</span></span>
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaultNotes}
          placeholder="Observaciones que no van en la cotización al cliente"
          className={`${inputCls} resize-none`}
        />
      </label>

      {/* ── Editor de líneas ── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Líneas de servicio
          </h2>
          <button
            type="button"
            onClick={addLine}
            className="rounded-[var(--radius)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30 hover:bg-[var(--color-primary)]/5 transition"
          >
            + Agregar línea
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div
              key={line.key}
              className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-xs font-medium ${mutedCls}`}>Línea {idx + 1}</span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    className="text-xs text-[var(--color-danger)] hover:underline"
                  >
                    Eliminar
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
                <label className="block sm:col-span-1">
                  <span className={`${labelCls} text-xs`}>Descripción del servicio</span>
                  <input
                    type="text"
                    value={line.service}
                    onChange={(e) => updateLine(line.key, "service", e.target.value)}
                    placeholder="Flete marítimo, manejo, etc."
                    required
                    className={inputCls}
                  />
                </label>

                <label className="block w-24">
                  <span className={`${labelCls} text-xs`}>Cantidad</span>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, "qty", e.target.value)}
                    className={inputCls}
                  />
                </label>

                <label className="block w-32">
                  <span className={`${labelCls} text-xs`}>Precio ({currency})</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unit_price}
                    onChange={(e) => updateLine(line.key, "unit_price", e.target.value)}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </label>

                <label className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    checked={line.taxable}
                    onChange={(e) => updateLine(line.key, "taxable", e.target.checked)}
                    className="h-4 w-4 rounded accent-[var(--color-primary)]"
                  />
                  <span className="text-xs text-[var(--color-text)]">ITBIS</span>
                </label>
              </div>

              {canSeeCosts && (
                <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <label className="block w-32">
                    <span className={`${labelCls} text-xs text-[var(--color-text-muted)]`}>Costo ({currency})</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.cost}
                      onChange={(e) => updateLine(line.key, "cost", e.target.value)}
                      placeholder="0.00"
                      className={`${inputCls} border-dashed`}
                    />
                  </label>
                </div>
              )}

              {/* Preview por línea */}
              {(parseFloat(line.unit_price) > 0 || parseFloat(line.qty) > 0) && (
                <div className={`mt-2 text-xs ${mutedCls} text-right`}>
                  {(() => {
                    const qty = parseFloat(line.qty) || 0;
                    const up  = parseFloat(line.unit_price) || 0;
                    const sub = qty * up;
                    const itbis = line.taxable ? sub * 0.18 : 0;
                    return `Subtotal: ${fmtMoney(sub, currency)}${line.taxable ? ` + ITBIS ${fmtMoney(itbis, currency)}` : ""} = ${fmtMoney(sub + itbis, currency)}`;
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Totales ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Totales</h3>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className={mutedCls}>Subtotal</dt>
            <dd>{fmtMoney(totals.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className={mutedCls}>ITBIS (18%)</dt>
            <dd>{fmtMoney(totals.itbis, currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--color-border)] pt-1 font-semibold">
            <dt>Total</dt>
            <dd>{fmtMoney(totals.total, currency)}</dd>
          </div>

          {canSeeCosts && costSummary && (
            <>
              <div className="flex justify-between pt-2">
                <dt className={mutedCls}>Costo total</dt>
                <dd className={mutedCls}>{fmtMoney(costSummary.total_cost, currency)}</dd>
              </div>
              <div className="flex justify-between font-medium">
                <dt className={mutedCls}>Margen</dt>
                <dd className={costSummary.margin >= 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-danger)]"}>
                  {fmtMoney(costSummary.margin, currency)} ({costSummary.margin_pct.toFixed(1)}%)
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {/* ── Acciones ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{submitLabel}</Button>
        <a
          href={quoteId ? `/cotizaciones/${quoteId}` : "/cotizaciones"}
          className="text-sm text-[var(--color-text-muted)] hover:underline"
        >
          Cancelar
        </a>
      </div>
    </form>
  );
}
