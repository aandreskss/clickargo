import { createClient }  from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { CsvExporter }   from "@/lib/erp/csv-exporter";
import { JsonExporter }  from "@/lib/erp/json-exporter";
import type { PreInvoiceExport } from "@/lib/erp/exporter";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  const url    = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (!["csv", "json"].includes(format)) {
    return Response.json({ error: "formato inválido; usa ?format=csv o ?format=json" }, { status: 400 });
  }

  const tenant = await tenantFromHost();
  if (!tenant) return Response.json({ error: "tenant no encontrado" }, { status: 403 });

  const supabase = await createClient();

  // Verificar sesión activa
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "no autenticado" }, { status: 401 });

  // Verificar membresía y rol (finance, manager, admin, owner pueden exportar)
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const allowedRoles = ["owner", "admin", "finance", "manager"];
  if (!membership || !allowedRoles.includes(membership.role)) {
    return Response.json({ error: "sin permiso para exportar" }, { status: 403 });
  }

  // Cargar prefactura
  const { data: pi } = await supabase
    .from("pre_invoices")
    .select("id, number, status, currency, subtotal, tax_total, total, exchange_rate, notes, created_at, account_id")
    .eq("id", id)
    .maybeSingle();

  if (!pi) return Response.json({ error: "prefactura no encontrada" }, { status: 404 });

  // Cargar líneas y cuenta
  const [{ data: lines }, { data: acc }] = await Promise.all([
    supabase
      .from("pre_invoice_lines")
      .select("charge_type_code, description, quantity, unit, unit_price, currency, tax_rate, subtotal, tax_amount, total, sort_order")
      .eq("pre_invoice_id", id)
      .order("sort_order"),
    supabase
      .from("accounts")
      .select("name, tax_id")
      .eq("id", pi.account_id)
      .maybeSingle(),
  ]);

  const payload: PreInvoiceExport = {
    id:             pi.id,
    number:         pi.number,
    account_name:   acc?.name ?? "—",
    account_tax_id: acc?.tax_id ?? null,
    status:         pi.status,
    currency:       pi.currency,
    subtotal:       Number(pi.subtotal),
    tax_total:      Number(pi.tax_total),
    total:          Number(pi.total),
    exchange_rate:  pi.exchange_rate ? Number(pi.exchange_rate) : null,
    notes:          pi.notes ?? null,
    created_at:     pi.created_at,
    lines:          (lines ?? []).map((l) => ({
      charge_type_code: l.charge_type_code,
      description:      l.description,
      quantity:         Number(l.quantity),
      unit:             l.unit,
      unit_price:       Number(l.unit_price),
      currency:         l.currency,
      tax_rate:         Number(l.tax_rate),
      subtotal:         Number(l.subtotal),
      tax_amount:       Number(l.tax_amount),
      total:            Number(l.total),
      sort_order:       l.sort_order,
    })),
  };

  // Registrar en security_events (uso admin client para evitar depender de RLS en tabla append-only)
  // Log mínimo sin datos sensibles
  console.info(`[export] prefactura=${pi.number} formato=${format} usuario=${user.id} tenant=${tenant.id}`);

  if (format === "json") {
    const exporter = new JsonExporter();
    const json     = exporter.toJson(payload);
    return new Response(json, {
      status: 200,
      headers: {
        "Content-Type":        "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="prefactura-${pi.number}.json"`,
        "Cache-Control":       "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // CSV por defecto
  const exporter = new CsvExporter();
  const csv      = exporter.toCsv(payload);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prefactura-${pi.number}.csv"`,
      "Cache-Control":       "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
