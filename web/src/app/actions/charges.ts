"use server";

import { redirect }      from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient }  from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import {
  CreateChargeSchema,
  UpdateChargeSchema,
  UpsertChargeCostSchema,
  CreateExchangeRateSchema,
} from "@/lib/schemas/charge.schema";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f-]{36}$/i;

// ── Crear cargo de venta ───────────────────────────────────────────────────────
export async function createCharge(formData: FormData) {
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(shipmentId)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${shipmentId}?tab=cargos`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = CreateChargeSchema.safeParse({
    shipment_id:        shipmentId,
    charge_type_id:     str(formData, "charge_type_id"),
    description:        str(formData, "description"),
    quantity:           str(formData, "quantity"),
    unit:               str(formData, "unit"),
    unit_price:         str(formData, "unit_price"),
    currency:           str(formData, "currency") || "USD",
    tax_rate:           str(formData, "tax_rate") || "0",
    bill_to_account_id: str(formData, "bill_to_account_id") || undefined,
    sort_order:         str(formData, "sort_order") || "0",
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { data: d } = result;
  const supabase = await createClient();

  const { error } = await supabase.from("shipment_charges").insert({
    tenant_id:          tenant.id,
    shipment_id:        d.shipment_id,
    charge_type_id:     d.charge_type_id,
    description:        d.description,
    quantity:           d.quantity,
    unit:               d.unit,
    unit_price:         d.unit_price,
    currency:           d.currency,
    tax_rate:           d.tax_rate,
    bill_to_account_id: d.bill_to_account_id || null,
    sort_order:         d.sort_order,
  });

  if (error) {
    const key: MsgKey = /row-level security/i.test(error.message)
      ? "sin_permiso_crear"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "cargo_de_embarque_guardado"));
}

// ── Actualizar cargo de venta ──────────────────────────────────────────────────
export async function updateCharge(formData: FormData) {
  const id = str(formData, "id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(id) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl("/embarques", "id_invalido"));
  }
  const back = `/embarques/${shipmentId}?tab=cargos`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = UpdateChargeSchema.safeParse({
    id,
    charge_type_id:     str(formData, "charge_type_id"),
    description:        str(formData, "description"),
    quantity:           str(formData, "quantity"),
    unit:               str(formData, "unit"),
    unit_price:         str(formData, "unit_price"),
    currency:           str(formData, "currency") || "USD",
    tax_rate:           str(formData, "tax_rate") || "0",
    bill_to_account_id: str(formData, "bill_to_account_id") || undefined,
    sort_order:         str(formData, "sort_order") || "0",
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { data: d } = result;
  const supabase = await createClient();

  // Verificar que existe y pertenece al tenant (RLS lo fuerza, pero validamos explícitamente)
  const { data: existing } = await supabase
    .from("shipment_charges")
    .select("pre_invoice_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) redirect(errUrl(back, "id_invalido"));
  if (existing.pre_invoice_id) redirect(errUrl(back, "cargo_bloqueado_prefactura"));

  const { error } = await supabase
    .from("shipment_charges")
    .update({
      charge_type_id:     d.charge_type_id,
      description:        d.description,
      quantity:           d.quantity,
      unit:               d.unit,
      unit_price:         d.unit_price,
      currency:           d.currency,
      tax_rate:           d.tax_rate,
      bill_to_account_id: d.bill_to_account_id || null,
      sort_order:         d.sort_order,
    })
    .eq("id", id);

  if (error) {
    const key: MsgKey = /row-level security/i.test(error.message)
      ? "sin_permiso_editar"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "cargo_de_embarque_actualizado"));
}

// ── Eliminar cargo de venta ───────────────────────────────────────────────────
export async function deleteCharge(formData: FormData) {
  const id = str(formData, "id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(id) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl("/embarques", "id_invalido"));
  }
  const back = `/embarques/${shipmentId}?tab=cargos`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("shipment_charges")
    .select("pre_invoice_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) redirect(errUrl(back, "id_invalido"));
  if (existing.pre_invoice_id) redirect(errUrl(back, "cargo_bloqueado_prefactura"));

  const { error } = await supabase
    .from("shipment_charges")
    .delete()
    .eq("id", id);

  if (error) {
    const key: MsgKey = /row-level security/i.test(error.message)
      ? "sin_permiso_eliminar"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "cargo_de_embarque_eliminado"));
}

// ── Importar cargos desde cotización vinculada ────────────────────────────────
export async function importFromQuote(formData: FormData) {
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(shipmentId)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${shipmentId}?tab=cargos`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const supabase = await createClient();

  // Obtener el embarque y su cotización vinculada
  const { data: ship } = await supabase
    .from("shipments")
    .select("quote_id, account_id")
    .eq("id", shipmentId)
    .maybeSingle();

  if (!ship?.quote_id) redirect(errUrl(back, "error_generico"));

  // Obtener líneas de la cotización (sin costos — esos son internos)
  const { data: lines } = await supabase
    .from("quote_lines")
    .select("service, qty, unit_price, currency, taxable, sort_order")
    .eq("quote_id", ship.quote_id)
    .order("sort_order");

  if (!lines || lines.length === 0) redirect(errUrl(back, "lineas_obligatorias"));

  const rows = lines.map((l) => ({
    tenant_id:          tenant.id,
    shipment_id:        shipmentId,
    charge_type_id:     "otro",
    description:        l.service,
    quantity:           l.qty,
    unit:               "unit" as const,
    unit_price:         l.unit_price,
    currency:           l.currency,
    tax_rate:           l.taxable ? 0.18 : 0,
    bill_to_account_id: ship.account_id,
    sort_order:         l.sort_order,
  }));

  const { error } = await supabase.from("shipment_charges").insert(rows);

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "cargos_importados_cotizacion"));
}

// ── Upsert costo interno de un cargo ─────────────────────────────────────────
export async function upsertChargeCost(formData: FormData) {
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(shipmentId)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${shipmentId}?tab=cargos`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const result = UpsertChargeCostSchema.safeParse({
    shipment_charge_id: str(formData, "shipment_charge_id"),
    vendor_account_id:  str(formData, "vendor_account_id") || undefined,
    unit_cost:          str(formData, "unit_cost"),
    currency:           str(formData, "currency") || "USD",
    vendor_invoice_ref: str(formData, "vendor_invoice_ref") || undefined,
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { data: d } = result;
  const supabase = await createClient();

  // Verificar can_see_costs — la RLS lo hace en BD, pero queremos error amigable
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: m } = await supabase
    .from("memberships")
    .select("can_see_costs")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!m?.can_see_costs) redirect(errUrl(back, "sin_permiso_ver_costos"));

  const { error } = await supabase.from("shipment_charge_costs").upsert({
    shipment_charge_id:  d.shipment_charge_id,
    tenant_id:           tenant.id,
    vendor_account_id:   d.vendor_account_id || null,
    unit_cost:           d.unit_cost,
    currency:            d.currency,
    vendor_invoice_ref:  d.vendor_invoice_ref || null,
  });

  if (error) {
    const key: MsgKey = /row-level security/i.test(error.message)
      ? "sin_permiso_ver_costos"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "costo_guardado"));
}

// ── Guardar tasa de cambio ────────────────────────────────────────────────────
export async function createExchangeRate(formData: FormData) {
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  const back = "/ajustes";

  const result = CreateExchangeRateSchema.safeParse({
    effective_date: str(formData, "effective_date"),
    usd_to_dop:     str(formData, "usd_to_dop"),
    source:         str(formData, "source") || undefined,
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { error } = await supabase.from("exchange_rates").upsert({
    tenant_id:      tenant.id,
    effective_date: result.data.effective_date,
    usd_to_dop:     result.data.usd_to_dop,
    source:         result.data.source || null,
  });

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath("/ajustes");
  redirect(okUrl(back, "tasa_guardada"));
}
