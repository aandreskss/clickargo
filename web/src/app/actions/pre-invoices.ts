"use server";

import { redirect }      from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient }  from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import {
  CreatePreInvoiceSchema,
  MarkInvoicedSchema,
  SaveCredentialsSchema,
} from "@/lib/schemas/pre-invoice.schema";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";
import { encrypt, maskSecret } from "@/lib/erp/crypto";
import { getErpExporter, type ErpProvider } from "@/lib/erp/index";
import type { PreInvoiceExport } from "@/lib/erp/exporter";
import { env } from "@/lib/env";

const str    = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f-]{36}$/i;

// ── Crear prefactura ──────────────────────────────────────────────────────────
export async function createPreInvoice(formData: FormData) {
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl("/prefacturas", "empresa_suspendida"));

  const result = CreatePreInvoiceSchema.safeParse({
    charge_ids:    str(formData, "charge_ids"),
    notes:         str(formData, "notes") || undefined,
    exchange_rate: str(formData, "exchange_rate") || undefined,
  });
  if (!result.success) redirect(errUrl("/prefacturas", "error_generico"));

  let chargeIds: string[];
  try {
    const parsed = JSON.parse(result.data.charge_ids) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      redirect(errUrl("/prefacturas", "cargos_obligatorios"));
    }
    chargeIds = parsed as string[];
  } catch {
    redirect(errUrl("/prefacturas", "error_generico"));
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_pre_invoice", {
    _tenant:        tenant.id,
    _charge_ids:    chargeIds,
    _notes:         result.data.notes || null,
    _exchange_rate: result.data.exchange_rate ? Number(result.data.exchange_rate) : null,
  });

  if (error) {
    let key: MsgKey = "error_generico";
    if (/cargos_obligatorios/i.test(error.message))        key = "cargos_obligatorios";
    else if (/cargo_bloqueado/i.test(error.message))       key = "cargo_bloqueado_prefactura";
    else if (/forbidden/i.test(error.message))             key = "sin_permiso_crear";
    redirect(errUrl("/prefacturas", key));
  }

  const newId = data as string;
  revalidatePath("/prefacturas");
  redirect(okUrl(`/prefacturas/${newId}`, "prefactura_creada"));
}

// ── Anular prefactura ─────────────────────────────────────────────────────────
export async function voidPreInvoice(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/prefacturas", "id_invalido"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const supabase = await createClient();

  const { error } = await supabase.rpc("void_pre_invoice", {
    _tenant:         tenant.id,
    _pre_invoice_id: id,
  });

  if (error) {
    let key: MsgKey = "error_generico";
    if (/prefactura_no_editable/i.test(error.message))  key = "prefactura_ya_facturada";
    else if (/prefactura_ya_anulada/i.test(error.message)) key = "prefactura_ya_anulada";
    else if (/forbidden/i.test(error.message))           key = "sin_permiso_editar";
    redirect(errUrl(`/prefacturas/${id}`, key));
  }

  revalidatePath("/prefacturas");
  revalidatePath(`/prefacturas/${id}`);
  redirect(okUrl("/prefacturas", "prefactura_anulada"));
}

// ── Registrar número de factura ERP ──────────────────────────────────────────
export async function markInvoiced(formData: FormData) {
  const result = MarkInvoicedSchema.safeParse({
    id:               str(formData, "id"),
    erp_document_ref: str(formData, "erp_document_ref"),
  });
  if (!result.success) redirect(errUrl("/prefacturas", "error_generico"));

  const { id, erp_document_ref } = result.data;
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const supabase = await createClient();

  const { error } = await supabase
    .from("pre_invoices")
    .update({ erp_document_ref, status: "invoiced" })
    .eq("id", id);

  if (error) redirect(errUrl(`/prefacturas/${id}`, "error_generico"));

  revalidatePath("/prefacturas");
  revalidatePath(`/prefacturas/${id}`);
  redirect(okUrl(`/prefacturas/${id}`, "factura_registrada"));
}

// ── Enviar al ERP ─────────────────────────────────────────────────────────────
export async function sendToErp(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/prefacturas", "id_invalido"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const provider = (env.ERP_PROVIDER ?? "none") as ErpProvider;
  if (provider === "none") redirect(errUrl(`/prefacturas/${id}`, "erp_no_configurado"));

  const supabase = await createClient();

  // Cargar prefactura + líneas + nombre del cliente
  const [{ data: pi }, { data: lines }, { data: account }] = await Promise.all([
    supabase
      .from("pre_invoices")
      .select("id, number, status, currency, subtotal, tax_total, total, exchange_rate, notes, created_at, account_id")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("pre_invoice_lines")
      .select("charge_type_code, description, quantity, unit, unit_price, currency, tax_rate, subtotal, tax_amount, total, sort_order")
      .eq("pre_invoice_id", id)
      .order("sort_order"),
    supabase
      .from("pre_invoices")
      .select("account_id")
      .eq("id", id)
      .maybeSingle(),
  ]);

  if (!pi) redirect(errUrl("/prefacturas", "prefactura_no_encontrada"));
  if (pi.status === "invoiced") redirect(errUrl(`/prefacturas/${id}`, "prefactura_ya_facturada"));
  if (pi.status === "void")     redirect(errUrl(`/prefacturas/${id}`, "prefactura_ya_anulada"));

  // Cargar nombre del cliente
  const { data: acc } = await supabase
    .from("accounts")
    .select("name, tax_id")
    .eq("id", pi.account_id)
    .maybeSingle();

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

  // Intentar envío con timeout de 10 segundos
  let ref: string;
  try {
    const exporter = getErpExporter(provider);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await exporter.send(payload);
      ref = r.ref;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[sendToErp] error:", err);
    redirect(errUrl(`/prefacturas/${id}`, "error_erp"));
  }

  // Marcar como enviada
  const { error: upErr } = await supabase
    .from("pre_invoices")
    .update({ status: "sent_to_erp", erp_provider: provider, erp_document_ref: ref!, sent_at: new Date().toISOString() })
    .eq("id", id);

  if (upErr) redirect(errUrl(`/prefacturas/${id}`, "error_generico"));

  revalidatePath("/prefacturas");
  revalidatePath(`/prefacturas/${id}`);
  redirect(okUrl(`/prefacturas/${id}`, "prefactura_enviada"));
}

// ── Guardar credenciales ERP ──────────────────────────────────────────────────
export async function saveCredentials(formData: FormData) {
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  const back = "/ajustes";

  const result = SaveCredentialsSchema.safeParse({
    provider: str(formData, "provider"),
    api_key:  str(formData, "api_key"),
    base_url: str(formData, "base_url") || undefined,
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { provider, api_key, base_url } = result.data;

  // Cifrar el payload
  const plaintext = JSON.stringify({ api_key, base_url: base_url ?? null });
  let encrypted: ReturnType<typeof encrypt>;
  try {
    encrypted = encrypt(plaintext);
  } catch {
    redirect(errUrl(back, "error_generico"));
  }

  const masked = maskSecret(api_key);
  const supabase = await createClient();

  const { error } = await supabase.from("integration_credentials").upsert({
    tenant_id:         tenant.id,
    provider,
    encrypted_payload: encrypted!.payload,
    iv:                encrypted!.iv,
    auth_tag:          encrypted!.authTag,
    masked_display:    masked,
  });

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath("/ajustes");
  redirect(okUrl(back, "credenciales_erp_guardadas"));
}
