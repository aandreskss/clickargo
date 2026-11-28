import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, Table, Td, Tr } from "@/components/ui";
import { BarChart } from "@/components/report-chart";
import type { BarItem } from "@/components/report-chart";
import { createClient } from "@/lib/supabase/server";

type ReportRow = {
  shipment_id: string;
  embarque: string;
  mes: string;
  account_id: string;
  cliente: string | null;
  origin_port_id: string | null;
  destination_port_id: string | null;
  mode: string | null;
  service_type: string | null;
  venta: number;
  costo: number;
  margen: number;
  margen_pct: number;
};

type GroupByStat = {
  label: string;
  venta: number;
  costo: number;
  margen: number;
};

const GROUP_LABELS: Record<string, string> = {
  cliente: "Cliente",
  ruta:    "Ruta",
  mes:     "Mes",
};

function mesLabel(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("es-DO", { month: "short", year: "numeric" });
}

function routeLabel(r: ReportRow) {
  return [r.origin_port_id, r.destination_port_id].filter(Boolean).join(" → ") || "Sin ruta";
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function RentabilidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string; month?: string; group_by?: string }>;
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

  // Guard: solo usuarios con can_see_costs
  const { data: m } = await supabase
    .from("memberships")
    .select("can_see_costs")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!m?.can_see_costs) {
    redirect(`/t/${slug}/reportes`);
  }

  const groupBy = (sp.group_by ?? "cliente") as "cliente" | "ruta" | "mes";

  let query = supabase
    .from("report_rentabilidad")
    .select(
      "shipment_id, embarque, mes, account_id, cliente, origin_port_id, destination_port_id, mode, service_type, venta, costo, margen, margen_pct",
    )
    .eq("tenant_id", tenant.id)
    .order("mes", { ascending: false })
    .limit(2000);

  const year = sp.year ? parseInt(sp.year, 10) : null;
  const month = sp.month ? parseInt(sp.month, 10) : null;
  if (year) {
    query = query.gte("mes", `${year}-01-01`).lte("mes", `${year}-12-31`);
  }
  if (year && month) {
    const pad = String(month).padStart(2, "0");
    query = query.gte("mes", `${year}-${pad}-01`).lte("mes", `${year}-${pad}-31`);
  }

  const { data: rows } = await query;
  const list = (rows ?? []) as ReportRow[];

  // Agrupar por dimensión
  const groupMap = new Map<string, GroupByStat>();
  for (const r of list) {
    const key =
      groupBy === "cliente"
        ? (r.cliente ?? r.account_id.slice(0, 8))
        : groupBy === "ruta"
        ? routeLabel(r)
        : mesLabel(r.mes);

    if (!groupMap.has(key)) groupMap.set(key, { label: key, venta: 0, costo: 0, margen: 0 });
    const g = groupMap.get(key)!;
    g.venta  += Number(r.venta);
    g.costo  += Number(r.costo);
    g.margen += Number(r.margen);
  }

  const groups = [...groupMap.values()].sort((a, b) => b.margen - a.margen);

  const totalVenta  = groups.reduce((a, g) => a + g.venta, 0);
  const totalCosto  = groups.reduce((a, g) => a + g.costo, 0);
  const totalMargen = groups.reduce((a, g) => a + g.margen, 0);
  const totalPct    = totalVenta > 0 ? ((totalMargen / totalVenta) * 100).toFixed(1) : "0.0";

  const chartItems: BarItem[] = groups.slice(0, 15).map((g) => ({
    label: g.label,
    value: g.margen,
    color: g.margen >= 0 ? "var(--color-chart-2)" : "var(--color-chart-4)",
  }));

  const baseUrl = `/t/${slug}/reportes/rentabilidad`;
  const csvUrl = `/api/reportes/rentabilidad?slug=${slug}${year ? `&year=${year}` : ""}${month ? `&month=${month}` : ""}&group_by=${groupBy}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <Link href={`/t/${slug}/reportes`} className="hover:underline">
              Reportes
            </Link>
            <span>/</span>
            <span>Rentabilidad</span>
          </div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">
            Rentabilidad de embarques
          </h1>
        </div>
        <a
          href={csvUrl}
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
          name="month"
          defaultValue={sp.month ?? ""}
          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          <option value="">Todos los meses</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(2000, m - 1).toLocaleDateString("es-DO", { month: "long" })}
            </option>
          ))}
        </select>
        <select
          name="group_by"
          defaultValue={groupBy}
          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          <option value="cliente">Agrupar por cliente</option>
          <option value="ruta">Agrupar por ruta</option>
          <option value="mes">Agrupar por mes</option>
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
          title="Sin datos de rentabilidad en el período"
          description="Los embarques necesitan cargos registrados para aparecer en este reporte."
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Venta total",  value: fmtMoney(totalVenta) },
              { label: "Costo total",  value: fmtMoney(totalCosto) },
              { label: "Margen total", value: fmtMoney(totalMargen) },
              { label: "Margen %",     value: `${totalPct}%` },
            ].map((k) => (
              <Card key={k.label} className="text-center">
                <p
                  className={`text-xl font-bold ${
                    k.label === "Margen total" || k.label === "Margen %"
                      ? totalMargen >= 0
                        ? "text-[var(--color-success-text)]"
                        : "text-[var(--color-error-text)]"
                      : "text-[var(--color-text)]"
                  }`}
                >
                  {k.value}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">{k.label}</p>
              </Card>
            ))}
          </div>

          <Card>
            <BarChart
              items={chartItems}
              title={`Margen por ${GROUP_LABELS[groupBy]?.toLowerCase() ?? groupBy}`}
              formatValue={fmtMoney}
            />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-[var(--color-text)]">
              Detalle por {GROUP_LABELS[groupBy]?.toLowerCase() ?? groupBy}
            </h2>
            <Table cols={[GROUP_LABELS[groupBy] ?? "Grupo", "Venta", "Costo", "Margen", "Margen %"]}>
              {groups.map((g) => {
                const pct = g.venta > 0 ? (g.margen / g.venta) * 100 : 0;
                return (
                  <Tr key={g.label}>
                    <Td>{g.label}</Td>
                    <Td className="text-right">{fmtMoney(g.venta)}</Td>
                    <Td className="text-right">{fmtMoney(g.costo)}</Td>
                    <Td
                      className={`text-right font-medium ${
                        g.margen >= 0
                          ? "text-[var(--color-success-text)]"
                          : "text-[var(--color-error-text)]"
                      }`}
                    >
                      {fmtMoney(g.margen)}
                    </Td>
                    <Td
                      className={`text-right ${
                        pct >= 0
                          ? "text-[var(--color-success-text)]"
                          : "text-[var(--color-error-text)]"
                      }`}
                    >
                      {pct.toLocaleString("es-DO", {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}%
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
