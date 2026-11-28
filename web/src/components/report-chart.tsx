"use client";

const fmt = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 1 });
const fmtInt = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });

// ── BarChart ─────────────────────────────────────────────────────────────────
// Lista de barras horizontales con label / valor / color (% del máximo).

export interface BarItem {
  label: string;
  value: number;
  color?: string; // var(--color-chart-N) o hex directo
  suffix?: string;
}

interface BarChartProps {
  items: BarItem[];
  title?: string;
  formatValue?: (v: number) => string;
}

export function BarChart({ items, title, formatValue }: BarChartProps) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-1">
      {title && (
        <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
          {title}
        </p>
      )}
      {items.map((item, idx) => {
        const pct = Math.round((item.value / max) * 100);
        const color = item.color ?? `var(--color-chart-${(idx % 6) + 1})`;
        const displayValue = formatValue
          ? formatValue(item.value)
          : fmt.format(item.value);

        return (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="w-36 shrink-0 truncate text-sm text-right text-[var(--color-text)]"
              title={item.label}
            >
              {item.label}
            </span>
            <div className="flex-1 h-6 bg-[var(--color-surface-muted)] rounded overflow-hidden">
              <div
                style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                className="h-full rounded transition-all"
              />
            </div>
            <span className="w-24 shrink-0 text-sm text-[var(--color-text-muted)]">
              {displayValue}
              {item.suffix ? " " + item.suffix : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── StackedBar ───────────────────────────────────────────────────────────────
// Una barra segmentada (eje X = total 100%) con múltiples categorías.

export interface StackedSegment {
  key: string;
  value: number;
  color: string;
}

interface StackedBarProps {
  label: string;
  segments: StackedSegment[];
  total: number;
}

export function StackedBar({ label, segments, total }: StackedBarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-right text-[var(--color-text-muted)]">
        {label}
      </span>
      <div className="flex-1 h-5 flex overflow-hidden rounded bg-[var(--color-surface-muted)]">
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((seg) => (
              <div
                key={seg.key}
                title={`${seg.key}: ${fmtInt.format(seg.value)}`}
                style={{
                  width: `${(seg.value / total) * 100}%`,
                  backgroundColor: seg.color,
                }}
                className="h-full"
              />
            ))}
      </div>
      <span className="w-10 shrink-0 text-xs text-[var(--color-text-muted)]">
        {fmtInt.format(total)}
      </span>
    </div>
  );
}

// ── MonthlyStackedChart ──────────────────────────────────────────────────────
// Lista de StackedBar por mes con leyenda de colores.

export interface MonthlyRow {
  mes: string;    // "2026-06-01"
  segments: StackedSegment[];
  total: number;
}

interface MonthlyStackedChartProps {
  rows: MonthlyRow[];
  legend: Array<{ key: string; color: string; label: string }>;
  title?: string;
}

const mesLabel = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("es-DO", { month: "short", year: "2-digit" });
};

export function MonthlyStackedChart({
  rows,
  legend,
  title,
}: MonthlyStackedChartProps) {
  return (
    <div className="space-y-3">
      {title && (
        <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
          {title}
        </p>
      )}

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 pb-1">
        {legend.map((l) => (
          <div key={l.key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: l.color }}
            />
            <span className="text-xs text-[var(--color-text-muted)]">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Barras */}
      <div className="space-y-1.5">
        {rows.map((row) => (
          <StackedBar
            key={row.mes}
            label={mesLabel(row.mes)}
            segments={row.segments}
            total={row.total}
          />
        ))}
      </div>
    </div>
  );
}
