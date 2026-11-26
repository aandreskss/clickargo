import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Field, Notice, Table, Td, Tr } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { voidPreInvoice, markInvoiced, sendToErp } from "@/app/actions/pre-invoices";
import { SendEmailTrigger } from "@/components/send-email-trigger";
import { sendPreInvoicePdf } from "@/app/actions/documents";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const STATUS_LABELS: Record<string, string> = {
  draft:        "Borrador",
  ready:        "Lista para enviar",
  sent_to_erp:  "Enviada a ERP",
  invoiced:     "Facturada",
  void:         "Anulada",
};

const STATUS_COLORS: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  draft:       "default",
  ready:       "info",
  sent_to_erp: "warning",
  invoiced:    "success",
  void:        "danger",
};

export default async function FichaPreFactura({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { slug, id } = await params;
  const { ok, error } = await searchParams;
  const okMsg    = decode(ok);
  const errorMsg = decode(error);

  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user!.id)
    .maybeSingle();
  const role = membership?.role ?? "viewer";
  const canVoid    = ["owner", "admin"].includes(role);
  const canExport  = ["owner", "admin", "finance", "manager"].includes(role);

  const [{ data: pi }, { data: lines }] = await Promise.all([
    supabase
      .from("pre_invoices")
      .select("id, number, status, currency, subtotal, tax_total, total, exchange_rate, notes, erp_provider, erp_document_ref, sent_at, created_at, account_id, created_by")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("pre_invoice_lines")
      .select("id, charge_type_code, description, quantity, unit, unit_price, currency, tax_rate, subtotal, tax_amount, total, sort_order, shipment_id")
      .eq("pre_invoice_id", id)
      .order("sort_order"),
  ]);

  if (!pi) notFound();

  const [{ data: acc }, { data: emailLog }] = await Promise.all([
    supabase.from("accounts").select("name, tax_id, email").eq("id", pi.account_id).maybeSingle(),
    supabase.from("outbound_emails")
      .select("id, to_email, subject, status, created_at")
      .eq("related_type", "pre_invoice").eq("related_id", id)
      .order("created_at", { ascending: false }).limit(10),
  ]);

  const fmtMoney = (n: number, cur = "USD") =>
    new Intl.NumberFormat("es-DO", { style: "currency", currency: cur }).format(n);

  const unitLabel: Record<string, string> = {
    container: "Contenedor", kg: "Kg", cbm: "CBM", unit: "Unidad", flat: "Global",
  };

  const canSend   = ["draft", "ready"].includes(pi.status);
  const isVoid    = pi.status === "void";
  const isInvoiced = pi.status === "invoiced";

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{pi.number}</h1>
            <Badge color={STATUS_COLORS[pi.status] ?? "default"}>
              {STATUS_LABELS[pi.status] ?? pi.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {acc?.name ?? "—"}{acc?.tax_id ? ` · RNC ${acc.tax_id}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/prefacturas">
            <Button variant="ghost" type="button">← Volver</Button>
          </Link>
          {canExport && !isVoid && (
            <>
              <a href={`/api/prefacturas/${id}/export?format=csv`}>
                <Button variant="ghost" type="button">Descargar CSV</Button>
              </a>
              <a href={`/api/prefacturas/${id}/export?format=json`}>
                <Button variant="ghost" type="button">Descargar JSON</Button>
              </a>
              <a href={`/api/documentos/prefactura/${id}`} download>
                <Button variant="ghost" type="button">Descargar PDF</Button>
              </a>
              <SendEmailTrigger
                documentType="pre_invoice"
                documentId={id}
                documentNumber={pi.number}
                defaultEmail={acc?.email ?? ""}
                pdfHref={`/api/documentos/prefactura/${id}`}
                action={sendPreInvoicePdf}
              />
            </>
          )}
          {canSend && !isVoid && (
            <form action={sendToErp}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit">Enviar a ADM Cloud</Button>
            </form>
          )}
        </div>
      </div>

      <Notice error={errorMsg} info={okMsg} />

      {/* Datos generales */}
      <Card>
        <dl className="grid gap-y-4 gap-x-6 sm:grid-cols-2 text-sm">
          <div>
            <dt className="font-medium text-[var(--color-text-muted)]">Cliente</dt>
            <dd className="text-[var(--color-text)]">{acc?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text-muted)]">RNC / Tax ID</dt>
            <dd className="text-[var(--color-text)]">{acc?.tax_id ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text-muted)]">Moneda</dt>
            <dd className="text-[var(--color-text)]">{pi.currency}</dd>
          </div>
          {pi.exchange_rate && (
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Tasa de cambio (DOP/USD)</dt>
              <dd className="text-[var(--color-text)]">{Number(pi.exchange_rate).toFixed(4)}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-[var(--color-text-muted)]">Fecha</dt>
            <dd className="text-[var(--color-text)]">
              {new Date(pi.created_at).toLocaleDateString("es-DO", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            </dd>
          </div>
          {pi.erp_document_ref && (
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">N° factura ERP</dt>
              <dd className="font-mono text-[var(--color-text)]">{pi.erp_document_ref}</dd>
            </div>
          )}
          {pi.sent_at && (
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Enviada el</dt>
              <dd className="text-[var(--color-text)]">
                {new Date(pi.sent_at).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" })}
              </dd>
            </div>
          )}
          {pi.notes && (
            <div className="sm:col-span-2">
              <dt className="font-medium text-[var(--color-text-muted)]">Notas</dt>
              <dd className="text-[var(--color-text)]">{pi.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Líneas congeladas */}
      {(lines ?? []).length === 0 ? (
        <Card>
          <EmptyState title="Sin líneas" description="Esta prefactura no tiene líneas registradas." />
        </Card>
      ) : (
        <Card className="p-0">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h2 className="font-semibold text-[var(--color-text)]">Detalle de cargos</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Copia congelada al momento de prefacturar — no cambia aunque se edite el cargo original.
            </p>
          </div>
          <Table cols={["Concepto", "Cant.", "Unidad", "Precio unit.", "Impuesto", "Total"]}>
            {(lines ?? []).map((l) => (
              <Tr key={l.id}>
                <Td>
                  <div className="font-medium">{l.description}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{l.charge_type_code}</div>
                </Td>
                <Td>{l.quantity}</Td>
                <Td>{unitLabel[l.unit] ?? l.unit}</Td>
                <Td>{fmtMoney(Number(l.unit_price), l.currency)}</Td>
                <Td>
                  {Number(l.tax_rate) > 0
                    ? fmtMoney(Number(l.tax_amount), l.currency)
                    : <span className="text-[var(--color-text-muted)]">—</span>
                  }
                </Td>
                <Td>
                  <span className="font-semibold">{fmtMoney(Number(l.total), l.currency)}</span>
                </Td>
              </Tr>
            ))}
          </Table>

          {/* Totales */}
          <div className="border-t border-[var(--color-border)] p-4 flex flex-col items-end gap-1 text-sm">
            <div className="flex gap-8">
              <span className="text-[var(--color-text-muted)]">Subtotal</span>
              <span className="font-medium w-32 text-right">{fmtMoney(Number(pi.subtotal), pi.currency)}</span>
            </div>
            <div className="flex gap-8">
              <span className="text-[var(--color-text-muted)]">Impuesto</span>
              <span className="font-medium w-32 text-right">{fmtMoney(Number(pi.tax_total), pi.currency)}</span>
            </div>
            <div className="flex gap-8 border-t border-[var(--color-border)] pt-1 mt-1">
              <span className="font-semibold text-[var(--color-text)]">TOTAL</span>
              <span className="font-bold text-lg w-32 text-right">{fmtMoney(Number(pi.total), pi.currency)}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Registrar N° factura ERP (cuando ya está enviada) */}
      {pi.status === "sent_to_erp" && (
        <Card>
          <h2 className="mb-3 font-semibold text-[var(--color-text)]">Registrar número de factura</h2>
          <form action={markInvoiced} className="flex flex-wrap gap-3 items-end">
            <input type="hidden" name="id" value={id} />
            <div className="flex-1 min-w-48">
              <Field
                name="erp_document_ref"
                label="N° de factura ADM Cloud"
                required
                placeholder="Ej. FAC-2024-001234"
              />
            </div>
            <Button type="submit">Registrar</Button>
          </form>
        </Card>
      )}

      {/* Anular */}
      {canVoid && !isVoid && !isInvoiced && (
        <Card>
          <h2 className="mb-2 font-semibold text-[var(--color-text)]">Anular prefactura</h2>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            Los cargos quedarán disponibles para ser prefacturados de nuevo.
          </p>
          <form action={voidPreInvoice}>
            <input type="hidden" name="id" value={id} />
            <Button variant="secondary" type="submit">Anular prefactura</Button>
          </form>
        </Card>
      )}

      {(emailLog ?? []).length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold text-[var(--color-text)]">Correos enviados</h2>
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
        </Card>
      )}
    </div>
  );
}
