"use server";

import { redirect }       from "next/navigation";
import { revalidatePath }  from "next/cache";
import { createClient }   from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import {
  CreateStorageStaySchema,
  ReleaseStorageStaySchema,
  CreateChargeFromStaySchema,
  UpsertStorageStayCostSchema,
} from "@/lib/schemas/storage.schema";
import { calcStay, calcStayCost } from "@/lib/storage-math";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";

const str    = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f-]{36}$/i;

function rls(msg: string): MsgKey {
  return /row-level security/i.test(msg) ? "sin_permiso_crear" : "error_generico";
}

// ── Registrar entrada ─────────────────────────────────────────────────────────
export async function createStorageStay(formData: FormData) {
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(shipmentId)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${shipmentId}?tab=almacenaje`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = CreateStorageStaySchema.safeParse({
    shipment_id:         shipmentId,
    provider_account_id: str(formData, "provider_account_id") || undefined,
    location_note:       str(formData, "location_note") || undefined,
    in_date:             str(formData, "in_date"),
    free_days:           str(formData, "free_days") || "0",
    sell_rate_per_day:   str(formData, "sell_rate_per_day") || "0",
    currency:            str(formData, "currency") || "USD",
    notes:               str(formData, "notes") || undefined,
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { data: d } = result;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { data: stay, error } = await supabase
    .from("storage_stays")
    .insert({
      tenant_id:           tenant.id,
      shipment_id:         d.shipment_id,
      provider_account_id: d.provider_account_id || null,
      location_note:       d.location_note || null,
      in_date:             d.in_date,
      free_days:           d.free_days,
      sell_rate_per_day:   d.sell_rate_per_day,
      currency:            d.currency,
      notes:               d.notes || null,
      created_by:          user.id,
    })
    .select("id")
    .single();

  if (error || !stay) redirect(errUrl(back, rls(error?.message ?? "")));

  // Registrar costo interno si viene del formulario (solo si can_see_costs)
  const costRate = str(formData, "cost_rate_per_day");
  if (costRate !== "") {
    const costParsed = parseFloat(costRate);
    if (!isNaN(costParsed) && costParsed >= 0) {
      await supabase.from("storage_stay_costs").insert({
        stay_id:           stay.id,
        tenant_id:         tenant.id,
        cost_rate_per_day: costParsed,
        vendor_invoice_ref: str(formData, "vendor_invoice_ref") || null,
        updated_by:        user.id,
      });
      // Si falla por RLS (usuario sin can_see_costs), simplemente se ignora.
    }
  }

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "entrada_registrada"));
}

// ── Registrar salida ──────────────────────────────────────────────────────────
export async function releaseStorageStay(formData: FormData) {
  const id         = str(formData, "id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(id) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl("/embarques", "id_invalido"));
  }
  const back = `/embarques/${shipmentId}?tab=almacenaje`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const result = ReleaseStorageStaySchema.safeParse({
    id, shipment_id: shipmentId, out_date: str(formData, "out_date"),
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { data: d } = result;
  const supabase = await createClient();

  // Verificar que la estadía existe y que out_date >= in_date
  const { data: existing } = await supabase
    .from("storage_stays")
    .select("in_date, status")
    .eq("id", d.id)
    .maybeSingle();

  if (!existing) redirect(errUrl(back, "id_invalido"));
  if (existing.status === "released") redirect(errUrl(back, "error_generico"));
  if (d.out_date < existing.in_date) redirect(errUrl(back, "fecha_salida_invalida"));

  const { error } = await supabase
    .from("storage_stays")
    .update({ out_date: d.out_date, status: "released" })
    .eq("id", d.id);

  if (error) redirect(errUrl(back, rls(error.message)));

  revalidatePath(`/embarques/${shipmentId}`);
  revalidatePath("/almacenaje");
  redirect(okUrl(back, "salida_registrada"));
}

// ── Crear cargo de almacenaje desde la estadía (idempotente) ─────────────────
export async function createChargeFromStay(formData: FormData) {
  const stayId     = str(formData, "stay_id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(stayId) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl("/embarques", "id_invalido"));
  }
  const back    = `/embarques/${shipmentId}?tab=almacenaje`;
  const backCargos = `/embarques/${shipmentId}?tab=cargos`;

  const result = CreateChargeFromStaySchema.safeParse({ stay_id: stayId, shipment_id: shipmentId });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  // Leer la estadía completa (RLS verifica membresía)
  const { data: stay } = await supabase
    .from("storage_stays")
    .select("*, cost:storage_stay_costs(cost_rate_per_day)")
    .eq("id", stayId)
    .maybeSingle();

  if (!stay) redirect(errUrl(back, "id_invalido"));

  // Idempotencia: si ya tiene cargo, redirigir con aviso
  if (stay.charge_id) redirect(okUrl(back, "cargo_ya_creado"));

  if (stay.status !== "released" || !stay.out_date) {
    redirect(errUrl(back, "error_generico"));
  }

  // Calcular días cobrables server-side
  const calc = calcStay(
    new Date(stay.in_date),
    new Date(stay.out_date),
    stay.free_days,
    stay.sell_rate_per_day,
  );

  const description = `Almacenaje – ${calc.billableDays} día${calc.billableDays !== 1 ? "s" : ""} cobrable${calc.billableDays !== 1 ? "s" : ""}`;

  // Crear shipment_charge
  const { data: charge, error: chargeErr } = await supabase
    .from("shipment_charges")
    .insert({
      tenant_id:      tenant.id,
      shipment_id:    shipmentId,
      charge_type_id: "almacenaje",
      description,
      quantity:       calc.billableDays,
      unit:           "day",
      unit_price:     stay.sell_rate_per_day,
      currency:       stay.currency,
      tax_rate:       0,
      sort_order:     0,
    })
    .select("id")
    .single();

  if (chargeErr || !charge) redirect(errUrl(back, rls(chargeErr?.message ?? "")));

  // Crear costo interno si existe tarifa de costo (solo si can_see_costs → RLS lo filtra)
  const costRecord = Array.isArray(stay.cost) ? stay.cost[0] : stay.cost;
  if (costRecord && costRecord.cost_rate_per_day > 0) {
    const costTotal = calcStayCost(calc.billableDays, costRecord.cost_rate_per_day);
    await supabase.from("shipment_charge_costs").insert({
      shipment_charge_id: charge.id,
      tenant_id:          tenant.id,
      unit_cost:          costRecord.cost_rate_per_day,
      currency:           stay.currency,
    });
    void costTotal; // calculado para referencia, el costo por día va en unit_cost
  }

  // Marcar la estadía como cargo creado (idempotencia futura)
  await supabase
    .from("storage_stays")
    .update({ charge_id: charge.id })
    .eq("id", stayId);

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(backCargos, "cargo_almacenaje_creado"));
}

// ── Eliminar estadía ──────────────────────────────────────────────────────────
export async function deleteStorageStay(formData: FormData) {
  const id         = str(formData, "id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(id) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl("/embarques", "id_invalido"));
  }
  const back = `/embarques/${shipmentId}?tab=almacenaje`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("storage_stays")
    .select("charge_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) redirect(errUrl(back, "id_invalido"));
  if (existing.charge_id) redirect(errUrl(back, "almacenaje_bloqueado"));

  const { error } = await supabase
    .from("storage_stays")
    .delete()
    .eq("id", id);

  if (error) redirect(errUrl(back, rls(error.message)));

  revalidatePath(`/embarques/${shipmentId}`);
  revalidatePath("/almacenaje");
  redirect(okUrl(back, "almacenaje_eliminado"));
}

// ── Actualizar costo de estadía ───────────────────────────────────────────────
export async function upsertStorageStayCost(formData: FormData) {
  const stayId     = str(formData, "stay_id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(stayId) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl("/embarques", "id_invalido"));
  }
  const back = `/embarques/${shipmentId}?tab=almacenaje`;

  const result = UpsertStorageStayCostSchema.safeParse({
    stay_id:            stayId,
    shipment_id:        shipmentId,
    cost_rate_per_day:  str(formData, "cost_rate_per_day"),
    vendor_invoice_ref: str(formData, "vendor_invoice_ref") || undefined,
  });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { data: d } = result;
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(back, "error_generico"));

  const { error } = await supabase.from("storage_stay_costs").upsert({
    stay_id:            d.stay_id,
    tenant_id:          tenant.id,
    cost_rate_per_day:  d.cost_rate_per_day,
    vendor_invoice_ref: d.vendor_invoice_ref || null,
    updated_by:         user.id,
  }, { onConflict: "stay_id" });

  if (error) redirect(errUrl(back, rls(error.message)));

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "costo_guardado"));
}
