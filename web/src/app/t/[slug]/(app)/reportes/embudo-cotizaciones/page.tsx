import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, Table, Td, Tr } from "@/components/ui";
import { BarChart } from "@/components/report-chart";
import type { BarItem } from "@/components/report-chart";
import { createClient } from "@/lib/supabase/server";

type ReportRow = {
  quote_id: string;
  mes: string;
  service_type: string | null;
  effective_status: string;
  created_by: string;
  vendedor: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft:     "Borrador",
  sent:      "Enviada",
  accepted:  "Aceptada",
  converted: "Convertida",
  expired:   "Vencida",
  rejected:  "Rechazada",
};

const STATUS_COLORS: Record<string, string> = {
  draft:     "var(--color-chart-6)",
  sent:      "var(--color-chart-3)",
  accepted:  "var(--color-chart-1)",
  converted: "var(--color-chart-2)",
  expired:   "var(--color-chart-4)",
  rejected:  "var(--color-chart-4)",
};

function mesLabel(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("es-DO", { month: "short", year: "numeric" });
}

export default async function EmbudoCotizacionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/t/${slug}/login`);

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  let query = supabase
    .from("report_embudo")
    .select(
      "quote_id, mes, service_type, effective_status, created_by, vendedor",
    )
    .eq("tenant_id", tenant.id)
    .order("mes")
    .limit(2000);

  const year = sp.year ? parseInt(sp.year, 10) : null;
  if (year) {
    query = query.gte("mes", `${year}-01-01`).lte("mes", `${year}-12-31`);
  }

  const { data: rows } = await query;
  const list = (rows ?? []) as ReportRow[];

  // Conteo global por effective_status
  const statusCount = new Map<string, number>();
  for (const r of list) {
    statusCount.set(r.effective_status, (statusCount.get(r.effective_status) ?? 0) + 1);
  }

  // Tasa de conversión = converted / (total excl. draft)
  const totalExclDraft = list.filter((r) => r.effective_status !== "draft").length;
  const converted = statusCount.get("converted") ?? 0;
  const conversionRate = totalExclDraft > 0
    ? ((converted / totalExclDraft) * 100).toFixed(1)
    : "0.0";

  // Funnel chart: orden de stages del embudo
  const funnelOrder = ["draft", "sent", "accepted", "converted", "expired", "rejected"];
  const chartItems: BarItem[] = funnelOrder
    .filter((s) => statusCount.has(s))
    .map((s, idx) => ({
      label: STATUS_LABELS[s] ?? s,
      value: statusCount.get(s)!,
      color: STATUS_COLORS[s] ?? `var(--color-chart-${(idx % 6) + 1})`,
    }));

  // Agrupar por mes → { mes → { status → count } }
  const mesStatusMap = new Map<string, Map<string, number>>();
  for (const r of list) {
    if (!mesStatusMap.has(r.mes)) mesStatusMap.set(r.mes, new Map());
    const m = mesStatusMap.get(r.mes)!;
    m.set(r.effective_status, (m.get(r.effective_status) ?? 0) + 1);
  }

  // Agrupar por vendedor
  const vendedorMap = new Map<string, { converted: number; total: number }>();
  for (const r of list) {
    if (r.effective_status === "draft") continue;
    const name = r.vendedor ?? r.created_by.slice(0, 8);
    if (!vendedorMap.has(name)) vendedorMap.set(name, { converted: 0, total: 0 });
    const v = vendedorMap.get(name)!;
    v.total += 1;
    if (r.effective_status === "converted") v.converted += 1;
  }

  const vendedores = [...vendedorMap.entries()].sort(
    (a, b) => b[1].converted - a[1].converted,
  );

  const meses = [...mesStatusMap.keys()].sort();
  const allStatuses = [...new Set(list.map((r) => r.effective_status))];

  const csvHref = `/api/reportes/embudo-cotizaciones?slug=${slug}${year ? `&year=${year}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <Link href={`/t/${slug}/reportes`} className="hover:underline">
              Reportes
            </Link>
            <span>/</span>
            <span>Embudo de cotizaciones</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">
            Embudo de cotizaciones
          </h1>
        </div>
        <a
          href={csvHref}
          className="shrink-0 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
        >
          Exportar CSV
        </a>
      </div>

      {/* Filtros */}
      <form
        method="GET"
        action={`/t/${slug}/reportes/embudo-cotizaciones`}
        className="flex flex-wrap gap-2"
      >
        <select
          name="year"
          defaultValue={sp.year ?? ""}
          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          <option value="">Todos los años</option>
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)]"
        >
          Filtrar
        </button>
      </form>

      {list.length === 0 ? (
        <EmptyState
          title="Sin cotizaciones en el período"
          description="Ajusta los filtros o verifica que haya cotizaciones registradas."
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { label: "Total cotizaciones", value: list.length.toLocaleString("es-DO") },
              { label: "Convertidas", value: converted.toLocaleString("es-DO") },
              { label: "Tasa de conversión", value: `${conversionRate}%` },
            ].map((k) => (
              <Card key={k.label} className="text-center">
                <p className="text-2xl font-bold text-[var(--color-text)]">{k.value}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">{k.label}</p>
              </Card>
            ))}
          </div>

          <Card>
            <BarChart items={chartItems} title="Distribución global por estado" />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-[var(--color-text)]">
              Cotizaciones por mes
            </h2>
            <Table
              cols={[
                "Mes",
                ...allStatuses.map((s) => STATUS_LABELS[s] ?? s),
                "Total",
              ]}
            >
              {meses.map((mes) => {
                const sm = mesStatusMap.get(mes)!;
                const total = [...sm.values()].reduce((a, v) => a + v, 0);
                return (
                  <Tr key={mes}>
                    <Td>{mesLabel(mes)}</Td>
                    {allStatuses.map((s) => (
                      <Td key={s} className="text-right">
                        {(sm.get(s) ?? 0).toLocaleString("es-DO")}
                      </Td>
                    ))}
                    <Td className="text-right font-semibold">
                      {total.toLocaleString("es-DO")}
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          </Card>

          {vendedores.length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold text-[var(--color-text)]">
                Por vendedor
              </h2>
              <Table cols={["Vendedor", "Total activas", "Convertidas", "Tasa"]}>
                {vendedores.map(([name, s]) => (
                  <Tr key={name}>
                    <Td>{name}</Td>
                    <Td className="text-right">{s.total.toLocaleString("es-DO")}</Td>
                    <Td className="text-right">{s.converted.toLocaleString("es-DO")}</Td>
                    <Td className="text-right">
                      {s.total > 0
                        ? ((s.converted / s.total) * 100).toLocaleString("es-DO", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          }) + "%"
                        : "—"}
                    </Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
