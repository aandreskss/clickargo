import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { createClient }     from "@/lib/supabase/server";
import { tenantFromHost }   from "@/lib/tenant";
import { PreInvoicePdf }    from "@/lib/pdf/pre-invoice-pdf";
import { getTenantBranding, getDocumentTemplate } from "@/lib/pdf/pdf-data";
import type { PreInvoiceLineItem } from "@/lib/pdf/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const ALLOWED_ROLES = ["owner", "admin", "finance", "manager"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "id inválido" }, { status: 400 });
  }

  const tenant = await tenantFromHost();
  if (!tenant) return Response.json({ error: "tenant no encontrado" }, { status: 403 });

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "no autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
    return Response.json({ error: "sin permiso para ver prefacturas" }, { status: 403 });
  }

  const [{ data: pi }, { data: rawLines }] = await Promise.all([
    supabase
      .from("pre_invoices")
      .select("id, number, status, currency, subtotal, tax_total, total, exchange_rate, notes, created_at, account_id")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("pre_invoice_lines")
      .select("description, quantity, unit, unit_price, currency, tax_rate, subtotal, tax_amount, total, sort_order")
      .eq("pre_invoice_id", id)
      .order("sort_order"),
  ]);

  if (!pi) return Response.json({ error: "prefactura no encontrada" }, { status: 404 });

  const [{ data: account }, branding, template] = await Promise.all([
    supabase.from("accounts").select("name, tax_id, email").eq("id", pi.account_id).maybeSingle(),
    getTenantBranding(supabase, tenant.id, tenant.logo_url ?? null),
    getDocumentTemplate(supabase, tenant.id, "pre_invoice"),
  ]);

  const lines: PreInvoiceLineItem[] = (rawLines ?? []).map((l) => ({
    description: l.description,
    quantity:    Number(l.quantity),
    unit:        l.unit,
    unit_price:  Number(l.unit_price),
    currency:    l.currency,
    tax_rate:    Number(l.tax_rate),
    subtotal:    Number(l.subtotal),
    tax_amount:  Number(l.tax_amount),
    total:       Number(l.total),
  }));

  try {
    const pdfEl = React.createElement(PreInvoicePdf, {
      data: {
        tenant:   branding,
        template,
        pre_invoice: {
          number:        pi.number,
          status:        pi.status,
          currency:      pi.currency,
          subtotal:      Number(pi.subtotal),
          tax_total:     Number(pi.tax_total),
          total:         Number(pi.total),
          exchange_rate: pi.exchange_rate ? Number(pi.exchange_rate) : null,
          notes:         pi.notes ?? null,
          created_at:    pi.created_at,
        },
        account: {
          name:   account?.name ?? "—",
          tax_id: account?.tax_id ?? null,
          email:  account?.email ?? null,
        },
        lines,
      },
    }) as unknown as React.ReactElement<DocumentProps>;

    const buffer = await renderToBuffer(pdfEl);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":           "application/pdf",
        "Content-Disposition":    `attachment; filename="prefactura-${pi.number}.pdf"`,
        "Cache-Control":          "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[pdf/prefactura] error al generar PDF:", err);
    return Response.json({ error: "error al generar PDF" }, { status: 500 });
  }
}
