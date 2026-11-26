"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import {
  CreateShipmentStep1Schema,
  UpdateShipmentStep2Schema,
  UpdateShipmentStep3Schema,
  AdvanceStageSchema,
  CancelShipmentSchema,
  ConvertQuoteSchema,
  ContainerSchema,
} from "@/lib/schemas/shipment.schema";
import { canAdvance, canRollback, isRollback, TERMINAL_STAGES } from "@/lib/stage-rules";
import { serviceToModeDirection } from "@/lib/field-packs";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";
import { z } from "zod";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f-]{36}$/i;

function parseContainersJson(raw: string): z.infer<typeof ContainerSchema>[] {
  if (!raw || raw === "[]") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const r = z.array(ContainerSchema).safeParse(parsed);
  return r.success ? r.data : [];
}

// ── Paso 1: Cliente, modo y dirección ──────────────────────────────────────────
export async function createShipmentStep1(formData: FormData) {
  const back = "/embarques/nuevo";

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = CreateShipmentStep1Schema.safeParse({
    account_id: str(formData, "account_id"),
    mode:       str(formData, "mode"),
    direction:  str(formData, "direction"),
    quote_id:   str(formData, "quote_id") || undefined,
  });

  if (!result.success) {
    const issue = result.error.issues[0]?.path?.[0];
    const key: MsgKey =
      issue === "account_id" ? "cliente_embarque_obligatorio"
      : issue === "mode"     ? "modo_obligatorio"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  const { account_id, mode, direction, quote_id } = result.data;
  const supabase = await createClient();

  // Si viene de una cotización, verificarla
  if (quote_id) {
    const { data: q } = await supabase
      .from("quotes")
      .select("id, status, account_id, service_type, notes")
      .eq("id", quote_id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!q || q.status !== "accepted") {
      redirect(errUrl(back, "cotizacion_no_convertible"));
    }
  }

  const { data: number, error: numErr } = await supabase.rpc("next_number", {
    _tenant: tenant.id,
    _key:    "shipments",
    _prefix: "EMB-",
  });
  if (numErr || !number) redirect(errUrl(back, "error_generico"));

  const { data: ship, error: sErr } = await supabase
    .from("shipments")
    .insert({
      tenant_id:  tenant.id,
      number:     number as string,
      account_id,
      mode,
      direction,
      stage_key:  "draft",
      quote_id:   quote_id || null,
    })
    .select("id")
    .single();

  if (sErr || !ship) {
    const key: MsgKey = /row-level security/i.test(sErr?.message ?? "")
      ? "sin_permiso_crear"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  // Insertar evento inicial
  await supabase.from("shipment_events").insert({
    tenant_id:          tenant.id,
    shipment_id:        ship.id,
    kind:               "stage_changed",
    to_stage:           "draft",
    message:            quote_id ? "Creado desde cotización" : "Embarque creado",
    visible_to_customer: false,
  });

  revalidatePath("/embarques");
  redirect(`/embarques/${ship.id}/paso/2`);
}

// ── Paso 2: Ruta, carga y contenedores ────────────────────────────────────────
export async function updateShipmentStep2(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${id}/paso/2`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = UpdateShipmentStep2Schema.safeParse({
    id,
    origin_port_id:      str(formData, "origin_port_id")      || undefined,
    destination_port_id: str(formData, "destination_port_id") || undefined,
    incoterm:            str(formData, "incoterm")             || undefined,
    carrier_account_id:  str(formData, "carrier_account_id")  || undefined,
    cargo_description:   str(formData, "cargo_description")   || undefined,
    packages:            str(formData, "packages")            || undefined,
    weight_kg:           str(formData, "weight_kg")           || undefined,
    volume_cbm:          str(formData, "volume_cbm")          || undefined,
  });

  if (!result.success) redirect(errUrl(back, "error_generico"));

  const { id: _, ...fields } = result.data;
  const containers = parseContainersJson(str(formData, "containers"));

  const supabase = await createClient();

  // Verificar que el embarque no sea terminal
  const { data: existing } = await supabase
    .from("shipments")
    .select("stage_key")
    .eq("id", id)
    .maybeSingle();

  if (!existing) redirect(errUrl("/embarques", "id_invalido"));
  if (TERMINAL_STAGES.has(existing.stage_key as never)) {
    redirect(errUrl(`/embarques/${id}`, "embarque_no_editable"));
  }

  const { error: upErr } = await supabase.from("shipments").update({
    origin_port_id:      (fields.origin_port_id      as string | undefined) || null,
    destination_port_id: (fields.destination_port_id as string | undefined) || null,
    incoterm:            (fields.incoterm             as string | undefined) || null,
    carrier_account_id:  (fields.carrier_account_id  as string | undefined) || null,
    cargo_description:   (fields.cargo_description   as string | undefined) || null,
    packages:            typeof fields.packages === "number"  ? fields.packages  : null,
    weight_kg:           typeof fields.weight_kg === "number" ? fields.weight_kg : null,
    volume_cbm:          typeof fields.volume_cbm === "number"? fields.volume_cbm: null,
  }).eq("id", id);

  if (upErr) redirect(errUrl(back, "error_generico"));

  // Reemplazar contenedores: borrar los viejos e insertar los nuevos
  await supabase.from("shipment_containers").delete().eq("shipment_id", id);

  if (containers.length > 0) {
    await supabase.from("shipment_containers").insert(
      containers.map((c) => ({
        tenant_id:        tenant.id,
        shipment_id:      id,
        container_number: (c.container_number as string | undefined) || null,
        container_type_id:(c.container_type_id as string | undefined)|| null,
        seal_number:      (c.seal_number as string | undefined)      || null,
        weight_kg:        typeof c.weight_kg === "number" ? c.weight_kg : null,
        notes:            (c.notes as string | undefined)            || null,
      }))
    );
  }

  revalidatePath(`/embarques/${id}`);
  redirect(`/embarques/${id}/paso/3`);
}

// ── Paso 3: Fechas y referencias ──────────────────────────────────────────────
export async function updateShipmentStep3(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${id}/paso/3`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = UpdateShipmentStep3Schema.safeParse({
    id,
    booking_number:         str(formData, "booking_number")         || undefined,
    bl_number:              str(formData, "bl_number")              || undefined,
    vessel_or_flight:       str(formData, "vessel_or_flight")       || undefined,
    voyage:                 str(formData, "voyage")                 || undefined,
    etd:                    str(formData, "etd")                    || undefined,
    eta:                    str(formData, "eta")                    || undefined,
    customer_reference:     str(formData, "customer_reference")     || undefined,
    shipper_account_id:     str(formData, "shipper_account_id")     || undefined,
    consignee_account_id:   str(formData, "consignee_account_id")   || undefined,
    notify_party_account_id:str(formData, "notify_party_account_id")|| undefined,
    notes:                  str(formData, "notes")                  || undefined,
    internal_notes:         str(formData, "internal_notes")         || undefined,
  });

  if (!result.success) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("shipments").select("stage_key").eq("id", id).maybeSingle();
  if (!existing) redirect(errUrl("/embarques", "id_invalido"));
  if (TERMINAL_STAGES.has(existing.stage_key as never)) {
    redirect(errUrl(`/embarques/${id}`, "embarque_no_editable"));
  }

  const f = result.data;
  const { error } = await supabase.from("shipments").update({
    booking_number:          (f.booking_number         as string | undefined) || null,
    bl_number:               (f.bl_number              as string | undefined) || null,
    vessel_or_flight:        (f.vessel_or_flight        as string | undefined) || null,
    voyage:                  (f.voyage                 as string | undefined) || null,
    etd:                     (f.etd                    as string | undefined) || null,
    eta:                     (f.eta                    as string | undefined) || null,
    customer_reference:      (f.customer_reference     as string | undefined) || null,
    shipper_account_id:      (f.shipper_account_id     as string | undefined) || null,
    consignee_account_id:    (f.consignee_account_id   as string | undefined) || null,
    notify_party_account_id: (f.notify_party_account_id as string | undefined)|| null,
    notes:                   (f.notes                  as string | undefined) || null,
    internal_notes:          (f.internal_notes         as string | undefined) || null,
  }).eq("id", id);

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath("/embarques");
  revalidatePath(`/embarques/${id}`);
  redirect(okUrl(`/embarques/${id}`, "embarque_guardado"));
}

// ── Avanzar etapa ─────────────────────────────────────────────────────────────
export async function advanceStage(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${id}`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = AdvanceStageSchema.safeParse({
    id,
    to_stage: str(formData, "to_stage"),
    reason:   str(formData, "reason") || undefined,
  });
  if (!result.success) redirect(errUrl(back, "etapa_invalida"));

  const { to_stage, reason } = result.data;
  const supabase = await createClient();

  // Re-fetch shipment completo desde DB (nunca confiar en el cliente)
  const { data: ship } = await supabase
    .from("shipments")
    .select(`id, stage_key, account_id, mode, direction,
             origin_port_id, destination_port_id,
             carrier_account_id, booking_number,
             etd, eta, atd, ata`)
    .eq("id", id)
    .maybeSingle();

  if (!ship) redirect(errUrl("/embarques", "id_invalido"));
  if (TERMINAL_STAGES.has(ship.stage_key as never)) {
    redirect(errUrl(back, "embarque_no_editable"));
  }

  // Verificar permiso para retroceso
  if (isRollback(ship.stage_key as never, to_stage as never)) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect(errUrl(back, "sin_permiso_avanzar"));

    const { data: m } = await supabase
      .from("memberships")
      .select("role")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!canRollback(m?.role ?? "")) {
      redirect(errUrl(back, "sin_permiso_avanzar"));
    }
    if (!reason) redirect(errUrl(back, "razon_obligatoria"));
  }

  // Validar campos requeridos para la nueva etapa
  const check = canAdvance(
    {
      account_id:          ship.account_id,
      mode:                ship.mode,
      direction:           ship.direction,
      origin_port_id:      ship.origin_port_id,
      destination_port_id: ship.destination_port_id,
      carrier_account_id:  ship.carrier_account_id,
      booking_number:      ship.booking_number,
      etd:                 ship.etd,
      eta:                 ship.eta,
      ata:                 ship.ata,
    },
    to_stage as never
  );
  if (!check.ok) redirect(errUrl(back, "campos_faltantes_etapa"));

  // Setear fechas reales cuando corresponde
  const extraFields: Record<string, string | null> = {};
  if (to_stage === "in_transit" && !ship.atd) {
    extraFields.atd = new Date().toISOString().split("T")[0];
  }
  if (to_stage === "delivered" && !ship.ata) {
    extraFields.ata = new Date().toISOString().split("T")[0];
  }

  const { error } = await supabase.from("shipments")
    .update({ stage_key: to_stage, ...extraFields })
    .eq("id", id);
  if (error) redirect(errUrl(back, "error_generico"));

  // Registrar evento
  await supabase.from("shipment_events").insert({
    tenant_id:          tenant.id,
    shipment_id:        id,
    kind:               "stage_changed",
    from_stage:         ship.stage_key,
    to_stage,
    message:            reason || null,
    visible_to_customer: false,
  });

  revalidatePath("/embarques");
  revalidatePath(back);
  redirect(okUrl(back, "embarque_avanzado"));
}

// ── Cancelar embarque ─────────────────────────────────────────────────────────
export async function cancelShipment(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${id}`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = CancelShipmentSchema.safeParse({
    id,
    reason: str(formData, "reason"),
  });
  if (!result.success) redirect(errUrl(back, "razon_obligatoria"));

  const supabase = await createClient();

  const { data: ship } = await supabase
    .from("shipments").select("stage_key").eq("id", id).maybeSingle();
  if (!ship) redirect(errUrl("/embarques", "id_invalido"));
  if (TERMINAL_STAGES.has(ship.stage_key as never)) {
    redirect(errUrl(back, "embarque_no_editable"));
  }

  const { error } = await supabase.from("shipments")
    .update({ stage_key: "cancelled" }).eq("id", id);
  if (error) redirect(errUrl(back, "error_generico"));

  await supabase.from("shipment_events").insert({
    tenant_id:          tenant.id,
    shipment_id:        id,
    kind:               "stage_changed",
    from_stage:         ship.stage_key,
    to_stage:           "cancelled",
    message:            result.data.reason,
    visible_to_customer: false,
  });

  revalidatePath("/embarques");
  revalidatePath(back);
  redirect(okUrl(back, "embarque_cancelado"));
}

// ── Actualizar embarque completo (edición directa) ───────────────────────────
export async function updateShipment(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/embarques", "id_invalido"));
  const back = `/embarques/${id}/editar`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("shipments").select("stage_key").eq("id", id).maybeSingle();
  if (!existing) redirect(errUrl("/embarques", "id_invalido"));
  if (TERMINAL_STAGES.has(existing.stage_key as never)) {
    redirect(errUrl(`/embarques/${id}`, "embarque_no_editable"));
  }

  const containers = parseContainersJson(str(formData, "containers"));

  const r2 = UpdateShipmentStep2Schema.safeParse({
    id,
    origin_port_id:      str(formData, "origin_port_id")      || undefined,
    destination_port_id: str(formData, "destination_port_id") || undefined,
    incoterm:            str(formData, "incoterm")             || undefined,
    carrier_account_id:  str(formData, "carrier_account_id")  || undefined,
    cargo_description:   str(formData, "cargo_description")   || undefined,
    packages:            str(formData, "packages")            || undefined,
    weight_kg:           str(formData, "weight_kg")           || undefined,
    volume_cbm:          str(formData, "volume_cbm")          || undefined,
  });

  const r3 = UpdateShipmentStep3Schema.safeParse({
    id,
    booking_number:          str(formData, "booking_number")          || undefined,
    bl_number:               str(formData, "bl_number")               || undefined,
    vessel_or_flight:        str(formData, "vessel_or_flight")        || undefined,
    voyage:                  str(formData, "voyage")                  || undefined,
    etd:                     str(formData, "etd")                     || undefined,
    eta:                     str(formData, "eta")                     || undefined,
    customer_reference:      str(formData, "customer_reference")      || undefined,
    shipper_account_id:      str(formData, "shipper_account_id")      || undefined,
    consignee_account_id:    str(formData, "consignee_account_id")    || undefined,
    notify_party_account_id: str(formData, "notify_party_account_id") || undefined,
    notes:                   str(formData, "notes")                   || undefined,
    internal_notes:          str(formData, "internal_notes")          || undefined,
  });

  if (!r2.success || !r3.success) redirect(errUrl(back, "error_generico"));

  const f2 = r2.data;
  const f3 = r3.data;

  const { error: upErr } = await supabase.from("shipments").update({
    origin_port_id:      (f2.origin_port_id      as string | undefined) || null,
    destination_port_id: (f2.destination_port_id as string | undefined) || null,
    incoterm:            (f2.incoterm             as string | undefined) || null,
    carrier_account_id:  (f2.carrier_account_id  as string | undefined) || null,
    cargo_description:   (f2.cargo_description   as string | undefined) || null,
    packages:            typeof f2.packages   === "number" ? f2.packages   : null,
    weight_kg:           typeof f2.weight_kg  === "number" ? f2.weight_kg  : null,
    volume_cbm:          typeof f2.volume_cbm === "number" ? f2.volume_cbm : null,
    booking_number:          (f3.booking_number         as string | undefined) || null,
    bl_number:               (f3.bl_number              as string | undefined) || null,
    vessel_or_flight:        (f3.vessel_or_flight        as string | undefined) || null,
    voyage:                  (f3.voyage                 as string | undefined) || null,
    etd:                     (f3.etd                    as string | undefined) || null,
    eta:                     (f3.eta                    as string | undefined) || null,
    customer_reference:      (f3.customer_reference     as string | undefined) || null,
    shipper_account_id:      (f3.shipper_account_id     as string | undefined) || null,
    consignee_account_id:    (f3.consignee_account_id   as string | undefined) || null,
    notify_party_account_id: (f3.notify_party_account_id as string | undefined) || null,
    notes:                   (f3.notes                  as string | undefined) || null,
    internal_notes:          (f3.internal_notes         as string | undefined) || null,
  }).eq("id", id);

  if (upErr) redirect(errUrl(back, "error_generico"));

  await supabase.from("shipment_containers").delete().eq("shipment_id", id);
  if (containers.length > 0) {
    await supabase.from("shipment_containers").insert(
      containers.map((c) => ({
        tenant_id:         tenant.id,
        shipment_id:       id,
        container_number:  (c.container_number  as string | undefined) || null,
        container_type_id: (c.container_type_id as string | undefined) || null,
        seal_number:       (c.seal_number       as string | undefined) || null,
        weight_kg:         typeof c.weight_kg === "number" ? c.weight_kg : null,
        notes:             (c.notes             as string | undefined) || null,
      }))
    );
  }

  revalidatePath("/embarques");
  revalidatePath(`/embarques/${id}`);
  redirect(okUrl(`/embarques/${id}`, "embarque_actualizado"));
}

// ── Convertir cotización en embarque ─────────────────────────────────────────
export async function convertQuoteToShipment(formData: FormData) {
  const quote_id = str(formData, "quote_id");
  if (!UUID_RE.test(quote_id)) redirect(errUrl("/cotizaciones", "id_invalido"));
  const back = `/cotizaciones/${quote_id}`;

  const result = ConvertQuoteSchema.safeParse({ quote_id });
  if (!result.success) redirect(errUrl(back, "cotizacion_no_convertible"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const supabase = await createClient();
  const { data: shipmentId, error } = await supabase.rpc("convert_quote_to_shipment", {
    _tenant:   tenant.id,
    _quote_id: quote_id,
  });

  if (error || !shipmentId) {
    redirect(errUrl(back, "cotizacion_no_convertible"));
  }

  revalidatePath("/cotizaciones");
  revalidatePath(back);
  revalidatePath("/embarques");
  redirect(`/embarques/${shipmentId}/paso/2`);
}
