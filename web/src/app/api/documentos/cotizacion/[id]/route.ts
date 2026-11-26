import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { createClient }     from "@/lib/supabase/server";
import { tenantFromHost }   from "@/lib/tenant";
import { QuotePdf }         from "@/lib/pdf/quote-pdf";
import { getTenantBranding, getDocumentTemplate } from "@/lib/pdf/pdf-data";
import type { QuoteLineItem, QuoteTotals } from "@/lib/pdf/types";

const UUID_RE = /^[0-9a-f-]{36}$/i;

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
  if (!membership) return Response.json({ error: "sin permiso" }, { status: 403 });

  const [{ data: quote }, { data: rawLines }] = await Promise.all([
    supabase
      .from("quotes")
      .select("id, number, status, service_type, origin, destination, currency, notes, valid_until, created_at, account_id")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("quote_lines")
      .select("service, qty, unit_price, currency, taxable, sort_order")
      .eq("quote_id", id)
      .order("sort_order"),
  ]);

  if (!quote) return Response.json({ error: "cotización no encontrada" }, { status: 404 });

  const [{ data: account }, branding, template] = await Promise.all([
    supabase.from("accounts").select("name, tax_id, email").eq("id", quote.account_id).maybeSingle(),
    getTenantBranding(supabase, tenant.id, tenant.logo_url ?? null),
    getDocumentTemplate(supabase, tenant.id, "quote"),
  ]);

  const lines: QuoteLineItem[] = (rawLines ?? []).map((l) => ({
    service:    l.service,
    qty:        Number(l.qty),
    unit_price: Number(l.unit_price),
    taxable:    Boolean(l.taxable),
    currency:   l.currency,
  }));

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const itbis    = lines.reduce((s, l) => s + (l.taxable ? l.qty * l.unit_price * 0.18 : 0), 0);
  const totals: QuoteTotals = { subtotal, itbis, total: subtotal + itbis };

  try {
    const pdfEl = React.createElement(QuotePdf, {
      data: {
        tenant:   branding,
        template,
        quote: {
          number:       quote.number,
          status:       quote.status,
          service_type: quote.service_type,
          origin:       quote.origin ?? null,
          destination:  quote.destination ?? null,
          currency:     quote.currency,
          notes:        quote.notes ?? null,
          valid_until:  quote.valid_until ?? null,
          created_at:   quote.created_at,
        },
        account: {
          name:         account?.name ?? "—",
          tax_id:       account?.tax_id ?? null,
          contact_name: null,
          email:        account?.email ?? null,
        },
        lines,
        totals,
      },
    }) as unknown as React.ReactElement<DocumentProps>;

    const buffer = await renderToBuffer(pdfEl);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":           "application/pdf",
        "Content-Disposition":    `attachment; filename="cotizacion-${quote.number}.pdf"`,
        "Cache-Control":          "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[pdf/cotizacion] error al generar PDF:", err);
    return Response.json({ error: "error al generar PDF" }, { status: 500 });
  }
}
