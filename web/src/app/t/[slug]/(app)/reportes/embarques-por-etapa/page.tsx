import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, Table, Td, Tr } from "@/components/ui";
import { MonthlyStackedChart } from "@/components/report-chart";
import type { MonthlyRow, StackedSegment } from "@/components/report-chart";
import { createClient } from "@/lib/supabase/server";

type ReportRow = {
  mes: string;
  stage_key: string;
  mode: string | null;
  direction: string | null;
  service_type: string | null;
  conteo: number;
};

const STAGE_LABELS: Record<string, string> = {
  draft: "Borrador",
  booked: "Reservado",
  in_transit: "En tránsito",
  at_destination: "En destino",
  delivered: "Entregado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STAGE_COLORS: Record<string, string> = {
  draft:          "var(--color-chart-6)",
  booked:         "var(--color-chart-3)",
  in_transit:     "var(--color-chart-1)",
  at_destination: "var(--color-chart-5)",
  delivered:      "var(--color-chart-2)",
  completed:      "var(--color-chart-2)",
  cancelled:      "var(--color-chart-4)",
};

function mesLabel(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("es-DO", { month: "short", year: "numeric" });
}

export default async function EmbarquesPorEtapaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string; mode?: string; direction?: string }>;
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
    .from("report_embarques_por_mes")
    .select("mes, stage_key, mode, direction, service_type, conteo")
    .eq("tenant_id", tenant.id)
    .order("mes")
    .limit(500);

  const year = sp.year ? parseInt(sp.year, 10) : null;
  if (year) {
    query = query
      .gte("mes", `${year}-01-01`)
      .lte("mes", `${year}-12-31`);
  }
  if (sp.mode) query = query.eq("mode", sp.mode);
  if (sp.direction) query = query.eq("direction", sp.direction);

  const { data: rows } = await query;
  const list = (rows ?? []) as ReportRow[];

  // Agrupar por mes → { stage_key → conteo }
  const mesMap = new Map<string, Map<string, number>>();
  for (const r of list) {
    if (!mesMap.has(r.mes)) mesMap.set(r.mes, new Map());
    const stages = mesMap.get(r.mes)!;
    stages.set(r.stage_key, (stages.get(r.stage_key) ?? 0) + r.conteo);
  }

  // Etapas únicas presentes en los datos
  const allStages = [...new Set(list.map((r) => r.stage_key))];

  const chartRows: MonthlyRow[] = [...mesMap.entries()].map(
    ([mes, stages]) => {
      const segments: StackedSegment[] = allStages
        .filter((s) => stages.has(s))
        .map((s) => ({
          key: STAGE_LABELS[s] ?? s,
          value: stages.get(s)!,
          color: STAGE_COLORS[s] ?? "var(--color-chart-1)",
        }));
      return { mes, segments, total: segments.reduce((a, s) => a + s.value, 0) };
    },
  );

  const legend = allStages.map((s) => ({
    key: s,
    color: STAGE_COLORS[s] ?? "var(--color-chart-1)",
    label: STAGE_LABELS[s] ?? s,
  }));

  const totalEmbarques = list.reduce((a, r) => a + r.conteo, 0);

  const baseUrl = `/t/${slug}/reportes/embarques-por-etapa`;
  const csvHref = `/api/reportes/embarques-por-etapa?slug=${slug}${year ? `&year=${year}` : ""}${sp.mode ? `&mode=${sp.mode}` : ""}${sp.direction ? `&direction=${sp.direction}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <Link href={`/t/${slug}/reportes`} className="hover:underline">
              Reportes
            </Link>
            <span>/</span>
            <span>Embarques por etapa</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">
            Embarques por etapa y mes
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
      <form method="GET" action={baseUrl} className="flex flex-wrap gap-2">
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
        <select
          name="mode"
          defaultValue={sp.mode ?? ""}
          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          <option value="">Todos los modos</option>
          <option value="ocean">Marítimo</option>
          <option value="air">Aéreo</option>
        </select>
        <select
          name="direction"
          defaultValue={sp.direction ?? ""}
          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          <option value="">Importación y exportación</option>
          <option value="import">Importación</option>
          <option value="export">Exportación</option>
        </select>
        <button
          type="submit"
          className="rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-primary-hover)]"
        >
          Filtrar
        </button>
      </form>

      {totalEmbarques === 0 ? (
        <EmptyState
          title="Sin datos para los filtros seleccionados"
          description="Ajusta los filtros o verifica que haya embarques registrados."
        />
      ) : (
        <>
          <Card>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              {totalEmbarques.toLocaleString("es-DO")} embarques en el período
            </p>
            <MonthlyStackedChart
              rows={chartRows}
              legend={legend}
              title="Distribución mensual por etapa"
            />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-[var(--color-text)]">
              Resumen por mes
            </h2>
            <Table cols={["Mes", ...allStages.map((s) => STAGE_LABELS[s] ?? s), "Total"]}>
              {chartRows.map((row) => {
                const stageMap = new Map(
                  row.segments.map((s) => [
                    allStages.find(
                      (k) => (STAGE_LABELS[k] ?? k) === s.key,
                    ) ?? s.key,
                    s.value,
                  ]),
                );
                return (
                  <Tr key={row.mes}>
                    <Td>{mesLabel(row.mes)}</Td>
                    {allStages.map((s) => (
                      <Td key={s} className="text-right">
                        {(stageMap.get(s) ?? 0).toLocaleString("es-DO")}
                      </Td>
                    ))}
                    <Td className="text-right font-semibold">
                      {row.total.toLocaleString("es-DO")}
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
