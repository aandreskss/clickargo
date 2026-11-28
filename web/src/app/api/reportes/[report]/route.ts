import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkLimit, reportsLimiter } from "@/lib/rate-limit";
import { ReportFiltersSchema, REPORT_NAMES } from "@/lib/schemas/report.schema";
import type { ReportName } from "@/lib/schemas/report.schema";

// Neutraliza fórmulas CSV (misma lógica que csv-exporter.ts)
function sc(value: string | number | boolean | null | undefined): string {
  const str = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(str)) return `'${str.replace(/"/g, '""')}`;
  return str.replace(/"/g, '""');
}
function row(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map((c) => `"${sc(c)}"`).join(",");
}

const VIEW_MAP: Record<ReportName, string> = {
  "embarques-por-etapa": "report_embarques_por_mes",
  puntualidad:           "report_puntualidad",
  "embudo-cotizaciones": "report_embudo",
  rentabilidad:          "report_rentabilidad",
};

const COLS: Record<ReportName, string[]> = {
  "embarques-por-etapa": ["Mes", "Etapa", "Modo", "Dirección", "Tipo servicio", "Conteo"],
  puntualidad:           ["Número", "Naviera", "Modo", "ETA", "ATA", "Etapa", "Días retraso", "Entregado tarde", "ETA vencida"],
  "embudo-cotizaciones": ["Mes", "Tipo servicio", "Estado efectivo", "Vendedor"],
  rentabilidad:          ["Embarque", "Mes", "Cliente", "Modo", "Tipo servicio", "Venta", "Costo", "Margen", "Margen %"],
};

function toRow(report: ReportName, r: Record<string, unknown>): (string | number | null)[] {
  switch (report) {
    case "embarques-por-etapa":
      return [r.mes as string, r.stage_key as string, r.mode as string, r.direction as string, r.service_type as string, r.conteo as number];
    case "puntualidad":
      return [r.number as string, r.naviera as string, r.mode as string, r.eta as string, r.ata as string, r.stage_key as string, r.dias_retraso as number, r.entregado_tarde ? "Sí" : "No", r.eta_vencida ? "Sí" : "No"];
    case "embudo-cotizaciones":
      return [r.mes as string, r.service_type as string, r.effective_status as string, r.vendedor as string];
    case "rentabilidad":
      return [r.embarque as string, r.mes as string, r.cliente as string, r.mode as string, r.service_type as string, r.venta as number, r.costo as number, r.margen as number, r.margen_pct as number];
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report } = await params;

  if (!(REPORT_NAMES as readonly string[]).includes(report)) {
    return NextResponse.json({ error: "reporte_invalido" }, { status: 404 });
  }
  const reportName = report as ReportName;

  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = ReportFiltersSchema.safeParse(sp);
  if (!parsed.success) {
    return NextResponse.json({ error: "filtros_invalidos" }, { status: 400 });
  }
  const filters = parsed.data;

  const slug = sp.slug as string | undefined;
  if (!slug) {
    return NextResponse.json({ error: "slug_requerido" }, { status: 400 });
  }

  const supabase = await createClient();

  // Autenticar
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }

  // Obtener tenant por slug
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t?.[0];
  if (!tenant) {
    return NextResponse.json({ error: "tenant_no_encontrado" }, { status: 404 });
  }

  // Verificar membresía activa + can_see_costs si aplica
  const { data: m } = await supabase
    .from("memberships")
    .select("can_see_costs, is_active")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!m?.is_active) {
    return NextResponse.json({ error: "sin_membresia" }, { status: 403 });
  }
  if (reportName === "rentabilidad" && !m.can_see_costs) {
    return NextResponse.json({ error: "sin_permiso_costos" }, { status: 403 });
  }

  // Rate limiting por user.id
  const allowed = await checkLimit(reportsLimiter, `reports:${user.id}`);
  if (!allowed) {
    return NextResponse.json({ error: "limite_excedido" }, { status: 429 });
  }

  // Query a la vista
  let query = supabase
    .from(VIEW_MAP[reportName])
    .select("*")
    .eq("tenant_id", tenant.id)
    .limit(5000);

  if (filters.year) {
    query = query
      .gte("mes", `${filters.year}-01-01`)
      .lte("mes", `${filters.year}-12-31`);
  }
  if (filters.year && filters.month) {
    const pad = String(filters.month).padStart(2, "0");
    query = query
      .gte("mes", `${filters.year}-${pad}-01`)
      .lte("mes", `${filters.year}-${pad}-31`);
  }
  if (filters.mode && reportName !== "embudo-cotizaciones" && reportName !== "rentabilidad") {
    query = query.eq("mode", filters.mode);
  }
  if (filters.direction && reportName === "embarques-por-etapa") {
    query = query.eq("direction", filters.direction);
  }

  const { data: rows, error: qErr } = await query;
  if (qErr) {
    return NextResponse.json({ error: "error_consulta" }, { status: 500 });
  }

  // Serializar a CSV con BOM UTF-8 (necesario para Excel con acentos)
  const lines: string[] = [row(COLS[reportName])];
  for (const r of rows ?? []) {
    lines.push(row(toRow(reportName, r as Record<string, unknown>)));
  }
  const csv = "﻿" + lines.join("\r\n");

  // Registrar exportación en security_events (SECURITY DEFINER, no requiere admin client)
  await supabase.rpc("log_report_export", {
    _tenant: tenant.id,
    _report: reportName,
    _meta: { year: filters.year ?? null, month: filters.month ?? null, rows: (rows ?? []).length },
  });

  const filename = `reporte-${reportName}-${filters.year ?? "todos"}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type":           "text/csv; charset=utf-8",
      "Content-Disposition":    `attachment; filename="${filename}"`,
      "Cache-Control":          "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
