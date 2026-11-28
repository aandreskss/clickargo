import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, Table, Td, Tr } from "@/components/ui";
import { BarChart } from "@/components/report-chart";
import type { BarItem } from "@/components/report-chart";
import { createClient } from "@/lib/supabase/server";

type ReportRow = {
  shipment_id: string;
  number: string;
  carrier_id: string | null;
  naviera: string | null;
  mode: string | null;
  eta: string;
  ata: string | null;
  stage_key: string;
  mes: string;
  dias_retraso: number | null;
  entregado_tarde: boolean;
  eta_vencida: boolean;
};

type NavieraStat = {
  naviera: string;
  total: number;
  tarde: number;
  vencidas: number;
  dias_sum: number;
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T12:00:00Z").toLocaleDateString("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function PuntualidadPage({
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
    .from("report_puntualidad")
    .select(
      "shipment_id, number, carrier_id, naviera, mode, eta, ata, stage_key, mes, dias_retraso, entregado_tarde, eta_vencida",
    )
    .eq("tenant_id", tenant.id)
    .order("eta", { ascending: false })
    .limit(2000);

  const year = sp.year ? parseInt(sp.year, 10) : null;
  if (year) {
    query = query.gte("mes", `${year}-01-01`).lte("mes", `${year}-12-31`);
  }

  const { data: rows } = await query;
  const list = (rows ?? []) as ReportRow[];

  // Agrupar por naviera
  const statMap = new Map<string, NavieraStat>();
  for (const r of list) {
    const key = r.naviera ?? "Sin naviera";
    if (!statMap.has(key)) {
      statMap.set(key, { naviera: key, total: 0, tarde: 0, vencidas: 0, dias_sum: 0 });
    }
    const s = statMap.get(key)!;
    s.total += 1;
    if (r.entregado_tarde) {
      s.tarde += 1;
      s.dias_sum += r.dias_retraso ?? 0;
    }
    if (r.eta_vencida) s.vencidas += 1;
  }

  const stats = [...statMap.values()].sort((a, b) => b.total - a.total);

  const chartItems: BarItem[] = stats
    .filter((s) => s.tarde > 0)
    .map((s) => ({
      label: s.naviera,
      value: parseFloat((s.dias_sum / s.tarde).toFixed(1)),
      suffix: "días",
    }));

  const totalVencidas = list.filter((r) => r.eta_vencida).length;
  const totalTarde = list.filter((r) => r.entregado_tarde).length;

  const csvHref = `/api/reportes/puntualidad?slug=${slug}${year ? `&year=${year}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <Link href={`/t/${slug}/reportes`} className="hover:underline">
              Reportes
            </Link>
            <span>/</span>
            <span>Puntualidad</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">
            Puntualidad por naviera
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
        action={`/t/${slug}/reportes/puntualidad`}
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
          title="Sin embarques con ETA registrada"
          description="Los embarques necesitan una fecha ETA para aparecer en este reporte."
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { label: "Embarques con ETA", value: list.length },
              { label: "Entregados tarde", value: totalTarde },
              { label: "ETA vencida (activos)", value: totalVencidas },
            ].map((k) => (
              <Card key={k.label} className="text-center">
                <p className="text-2xl font-bold text-[var(--color-text)]">
                  {k.value.toLocaleString("es-DO")}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {k.label}
                </p>
              </Card>
            ))}
          </div>

          {chartItems.length > 0 && (
            <Card>
              <BarChart
                items={chartItems}
                title="Días promedio de retraso por naviera"
                formatValue={(v) => v.toLocaleString("es-DO", { minimumFractionDigits: 1 })}
              />
            </Card>
          )}

          <Card>
            <h2 className="mb-3 font-semibold text-[var(--color-text)]">
              Resumen por naviera
            </h2>
            <Table
              cols={[
                "Naviera",
                "Total",
                "Entregados tarde",
                "ETA vencida",
                "Días prom. retraso",
              ]}
            >
              {stats.map((s) => (
                <Tr key={s.naviera}>
                  <Td>{s.naviera}</Td>
                  <Td className="text-right">{s.total.toLocaleString("es-DO")}</Td>
                  <Td className="text-right">
                    <span
                      className={
                        s.tarde > 0
                          ? "text-[var(--color-error-text)] font-medium"
                          : ""
                      }
                    >
                      {s.tarde.toLocaleString("es-DO")}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <span
                      className={
                        s.vencidas > 0
                          ? "text-[var(--color-warning-text)] font-medium"
                          : ""
                      }
                    >
                      {s.vencidas.toLocaleString("es-DO")}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {s.tarde > 0
                      ? (s.dias_sum / s.tarde).toLocaleString("es-DO", {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })
                      : "—"}
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
