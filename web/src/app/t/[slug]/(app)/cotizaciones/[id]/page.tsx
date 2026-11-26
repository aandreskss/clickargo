import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Card, Notice, Table, Td, Tr } from "@/components/ui";
import { serviceTypeLabel, statusConfig } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { calcTotals, calcMargin, fmtMoney } from "@/lib/quote-math";
import { changeQuoteStatus, duplicateQuote, deleteQuote } from "@/app/actions/quotes";
import { convertQuoteToShipment } from "@/app/actions/shipments";
import { SendEmailTrigger } from "@/components/send-email-trigger";
import { sendQuotePdf } from "@/app/actions/documents";

export default async function DetalleCotizacion({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { slug, id } = await params;
  const { ok, error } = await searchParams;
  const okMsg    = decode(ok);
  const errorMsg = decode(error);

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: { user } } = await supabase.auth.getUser();

  const [
    { data: quote },
    { data: lines },
    { data: membership },
  ] = await Promise.all([
    supabase.from("quotes")
      .select("id, number, status, service_type, origin, destination, currency, notes, valid_until, created_at, account_id")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("quote_lines")
      .select("id, service, qty, unit_price, currency, taxable, sort_order")
      .eq("quote_id", id)
      .order("sort_order"),
    user
      ? supabase.from("memberships").select("can_see_costs, role")
          .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!quote) notFound();

  const canSeeCosts = membership?.can_see_costs === true;

  // Cargar cuenta, costos, embarque vinculado e historial de correos
  const [{ data: account }, { data: costs }, { data: linkedShipment }, { data: emailLog }] =
    await Promise.all([
      supabase.from("accounts").select("name, kind, email").eq("id", quote.account_id).maybeSingle(),
      canSeeCosts
        ? supabase.from("quote_line_costs")
            .select("quote_line_id, cost, currency, vendor_id, notes")
            .in("quote_line_id", (lines ?? []).map((l) => l.id))
        : Promise.resolve({ data: null }),
      quote.status === "converted"
        ? supabase.from("shipments").select("id, number").eq("quote_id", id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("outbound_emails")
        .select("id, to_email, subject, status, created_at")
        .eq("related_type", "quote").eq("related_id", id)
        .order("created_at", { ascending: false }).limit(10),
    ]);

  // Estado efectivo (considerar expiración)
  const today = new Date().toISOString().split("T")[0];
  const effectiveStatus =
    quote.status === "sent" && quote.valid_until && quote.valid_until < today
      ? "expired"
      : quote.status;

  const sc = statusConfig(effectiveStatus);

  const mathLines = (lines ?? []).map((l) => ({
    qty:        Number(l.qty),
    unit_price: Number(l.unit_price),
    taxable:    l.taxable,
  }));
  const totals = calcTotals(mathLines);

  const totalCost = costs
    ? costs.reduce((s, c) => s + Number(c.cost), 0)
    : 0;
  const costSummary = canSeeCosts ? calcMargin(totals.total, totalCost) : null;

  const isDraft = quote.status === "draft";
  const isSent  = effectiveStatus === "sent";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{quote.number}</h1>
            <Badge color={sc.color}>{sc.label}</Badge>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            {serviceTypeLabel(quote.service_type)}
            {quote.origin && ` · ${quote.origin}`}
            {quote.destination && ` → ${quote.destination}`}
          </p>
        </div>
        <Link href="/cotizaciones">
          <Button variant="ghost" type="button">← Volver</Button>
        </Link>
      </div>

      <Notice error={errorMsg} info={okMsg} />

      {/* Datos generales */}
      <Card>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="font-medium text-[var(--color-text-muted)]">Cliente</dt>
            <dd className="text-[var(--color-text)]">{account?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text-muted)]">Moneda</dt>
            <dd className="text-[var(--color-text)]">{quote.currency}</dd>
          </div>
          {quote.valid_until && (
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Válida hasta</dt>
              <dd className="text-[var(--color-text)]">{quote.valid_until}</dd>
            </div>
          )}
          {quote.notes && (
            <div className="sm:col-span-2">
              <dt className="font-medium text-[var(--color-text-muted)]">Notas</dt>
              <dd className="text-[var(--color-text)] whitespace-pre-wrap">{quote.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Líneas */}
      <Card className="p-0">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-[var(--color-text)]">Líneas de servicio</h2>
        </div>
        <Table cols={canSeeCosts
          ? ["Descripción", "Cant.", "Precio", "ITBIS", "Total venta", "Costo"]
          : ["Descripción", "Cant.", "Precio", "ITBIS", "Total"]}>
          {(lines ?? []).map((l) => {
            const sub   = Number(l.qty) * Number(l.unit_price);
            const itbis = l.taxable ? sub * 0.18 : 0;
            const lineCost = costs?.find((c) => c.quote_line_id === l.id);
            return (
              <Tr key={l.id}>
                <Td>{l.service}</Td>
                <Td className="text-right tabular-nums">{Number(l.qty).toLocaleString("es-DO")}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(Number(l.unit_price), l.currency)}</Td>
                <Td className="text-right tabular-nums text-[var(--color-text-muted)]">
                  {l.taxable ? fmtMoney(itbis, l.currency) : "—"}
                </Td>
                <Td className="text-right tabular-nums font-medium">
                  {fmtMoney(sub + itbis, l.currency)}
                </Td>
                {canSeeCosts && (
                  <Td className="text-right tabular-nums text-[var(--color-text-muted)]">
                    {lineCost ? fmtMoney(Number(lineCost.cost), lineCost.currency) : "—"}
                  </Td>
                )}
              </Tr>
            );
          })}
        </Table>

        {/* Totales */}
        <div className="p-4 border-t border-[var(--color-border)]">
          <dl className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-text-muted)]">Subtotal</dt>
              <dd>{fmtMoney(totals.subtotal, quote.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-text-muted)]">ITBIS (18%)</dt>
              <dd>{fmtMoney(totals.itbis, quote.currency)}</dd>
            </div>
            <div className="flex justify-between font-semibold border-t border-[var(--color-border)] pt-1">
              <dt>Total</dt>
              <dd>{fmtMoney(totals.total, quote.currency)}</dd>
            </div>

            {canSeeCosts && costSummary && (
              <>
                <div className="flex justify-between pt-2">
                  <dt className="text-[var(--color-text-muted)]">Costo total</dt>
                  <dd className="text-[var(--color-text-muted)]">
                    {fmtMoney(costSummary.total_cost, quote.currency)}
                  </dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt className="text-[var(--color-text-muted)]">Margen</dt>
                  <dd className={costSummary.margin >= 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-danger)]"}>
                    {fmtMoney(costSummary.margin, quote.currency)}{" "}
                    ({costSummary.margin_pct.toFixed(1)}%)
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>
      </Card>

      {/* Acciones */}
      <Card>
        <h2 className="mb-3 font-semibold text-[var(--color-text)]">Acciones</h2>
        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <Link href={`/cotizaciones/${id}/editar`}>
              <Button type="button" variant="ghost">Editar</Button>
            </Link>
          )}

          {isDraft && (
            <form action={changeQuoteStatus}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="sent" />
              <Button>Marcar como enviada</Button>
            </form>
          )}

          {isSent && (
            <>
              <form action={changeQuoteStatus}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="accepted" />
                <Button>Marcar como aceptada</Button>
              </form>
              <form action={changeQuoteStatus}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="rejected" />
                <Button variant="ghost">Marcar como rechazada</Button>
              </form>
            </>
          )}

          {!isDraft && (
            <form action={changeQuoteStatus}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="draft" />
              <Button variant="ghost">Volver a borrador</Button>
            </form>
          )}

          <form action={duplicateQuote}>
            <input type="hidden" name="id" value={id} />
            <Button variant="ghost" type="submit">Duplicar</Button>
          </form>

          {effectiveStatus === "accepted" && (
            <form action={convertQuoteToShipment}>
              <input type="hidden" name="quote_id" value={id} />
              <Button type="submit">Crear embarque</Button>
            </form>
          )}

          {quote.status === "converted" && linkedShipment && (
            <Link href={`/embarques/${linkedShipment.id}`}>
              <Button variant="ghost" type="button">Ver embarque {linkedShipment.number}</Button>
            </Link>
          )}

          <a href={`/api/documentos/cotizacion/${id}`} download>
            <Button variant="ghost" type="button">Generar PDF</Button>
          </a>
          <SendEmailTrigger
            documentType="quote"
            documentId={id}
            documentNumber={quote.number}
            defaultEmail={account?.email ?? ""}
            pdfHref={`/api/documentos/cotizacion/${id}`}
            action={sendQuotePdf}
          />
        </div>

        {isDraft && (
          <div className="mt-4 border-t border-[var(--color-border)] pt-4">
            <form action={deleteQuote}>
              <input type="hidden" name="id" value={id} />
              <Button variant="danger">Eliminar cotización</Button>
            </form>
          </div>
        )}

        {(emailLog ?? []).length > 0 && (
          <div className="mt-4 border-t border-[var(--color-border)] pt-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text-muted)]">Correos enviados</h3>
            <ul className="space-y-1">
              {(emailLog ?? []).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-[var(--color-text)]">{e.to_email} — {e.subject}</span>
                  <span className={e.status === "sent" ? "text-[var(--color-success-text)]" : "text-[var(--color-danger)]"}>
                    {e.status === "sent" ? "Enviado" : "Fallido"}
                  </span>
                  <span className="shrink-0 text-[var(--color-text-muted)]">
                    {new Date(e.created_at).toLocaleDateString("es-DO")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
