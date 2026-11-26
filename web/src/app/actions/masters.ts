"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import {
  CreateMasterSchema,
  UpdateMasterSchema,
  LinkShipmentSchema,
  UnlinkShipmentSchema,
  ManualTrackingEventSchema,
  SuggestionActionSchema,
} from "@/lib/schemas/master.schema";
import { getTrackingProvider } from "@/lib/tracking";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f-]{36}$/i;

// ── Crear master ──────────────────────────────────────────────────────────────
export async function createMaster(formData: FormData) {
  const back = "/masters/nuevo";

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = CreateMasterSchema.safeParse({
    master_number:       str(formData, "master_number"),
    mode:                str(formData, "mode"),
    carrier_account_id:  str(formData, "carrier_account_id") || undefined,
    vessel_or_flight:    str(formData, "vessel_or_flight")   || undefined,
    voyage:              str(formData, "voyage")             || undefined,
    origin_port_id:      str(formData, "origin_port_id")     || undefined,
    destination_port_id: str(formData, "destination_port_id")|| undefined,
    etd:                 str(formData, "etd")                || undefined,
    eta:                 str(formData, "eta")                || undefined,
    notes:               str(formData, "notes")              || undefined,
    tracking_enabled:    str(formData, "tracking_enabled")   || undefined,
    tracking_provider:   str(formData, "tracking_provider")  || undefined,
    tracking_ref:        str(formData, "tracking_ref")       || undefined,
  });

  if (!result.success) {
    const issue = result.error.issues[0]?.path?.[0];
    const key: MsgKey = issue === "master_number" ? "campos_faltantes_master"
      : issue === "mode" ? "campos_faltantes_master"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  const f = result.data;
  const supabase = await createClient();

  const { data: number, error: numErr } = await supabase.rpc("next_number", {
    _tenant: tenant.id,
    _key:    "masters",
    _prefix: "MST-",
  });
  if (numErr || !number) redirect(errUrl(back, "error_generico"));

  const { data: master, error: insErr } = await supabase
    .from("masters")
    .insert({
      tenant_id:           tenant.id,
      number:              number as string,
      master_number:       f.master_number,
      mode:                f.mode,
      carrier_account_id:  (f.carrier_account_id as string | undefined) || null,
      vessel_or_flight:    (f.vessel_or_flight   as string | undefined) || null,
      voyage:              (f.voyage             as string | undefined) || null,
      origin_port_id:      (f.origin_port_id     as string | undefined) || null,
      destination_port_id: (f.destination_port_id as string | undefined) || null,
      etd:                 (f.etd                as string | undefined) || null,
      eta:                 (f.eta                as string | undefined) || null,
      notes:               (f.notes              as string | undefined) || null,
      tracking_enabled:    f.tracking_enabled ?? false,
      tracking_provider:   (f.tracking_provider  as string | undefined) || null,
      tracking_ref:        (f.tracking_ref       as string | undefined) || null,
    })
    .select("id")
    .single();

  if (insErr || !master) {
    const key: MsgKey = /row-level security/i.test(insErr?.message ?? "")
      ? "sin_permiso_crear"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  // Activar tracking con el proveedor si aplica
  if (f.tracking_enabled && f.tracking_ref && f.tracking_provider) {
    try {
      const provider = getTrackingProvider(f.tracking_provider as string);
      await provider.startTracking({
        id:                master.id,
        tenant_id:         tenant.id,
        tracking_ref:      f.tracking_ref as string,
        tracking_provider: f.tracking_provider as string,
        mode:              f.mode,
      });
    } catch {
      // El master ya fue creado; el tracking puede activarse más tarde.
    }
  }

  revalidatePath("/masters");
  redirect(okUrl(`/masters/${master.id}`, "master_guardado"));
}

// ── Actualizar master ─────────────────────────────────────────────────────────
export async function updateMaster(formData: FormData) {
  const id = str(formData, "id");
  if (!UUID_RE.test(id)) redirect(errUrl("/masters", "id_invalido"));
  const back = `/masters/${id}/editar`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = UpdateMasterSchema.safeParse({
    id,
    master_number:       str(formData, "master_number"),
    mode:                str(formData, "mode"),
    carrier_account_id:  str(formData, "carrier_account_id") || undefined,
    vessel_or_flight:    str(formData, "vessel_or_flight")   || undefined,
    voyage:              str(formData, "voyage")             || undefined,
    origin_port_id:      str(formData, "origin_port_id")     || undefined,
    destination_port_id: str(formData, "destination_port_id")|| undefined,
    etd:                 str(formData, "etd")                || undefined,
    eta:                 str(formData, "eta")                || undefined,
    atd:                 str(formData, "atd")                || undefined,
    ata:                 str(formData, "ata")                || undefined,
    notes:               str(formData, "notes")              || undefined,
    tracking_enabled:    str(formData, "tracking_enabled")   || undefined,
    tracking_provider:   str(formData, "tracking_provider")  || undefined,
    tracking_ref:        str(formData, "tracking_ref")       || undefined,
  });

  if (!result.success) redirect(errUrl(back, "error_generico"));

  const f = result.data;
  const supabase = await createClient();

  // Obtener el estado actual del master (para detectar cambios de ETA/schedule)
  const { data: existing } = await supabase
    .from("masters")
    .select("eta, etd, atd, ata, vessel_or_flight, voyage, tracking_enabled, tracking_ref, tracking_provider, mode")
    .eq("id", id)
    .maybeSingle();
  if (!existing) redirect(errUrl("/masters", "master_no_encontrado"));

  const { error: upErr } = await supabase.from("masters").update({
    master_number:       f.master_number,
    mode:                f.mode,
    carrier_account_id:  (f.carrier_account_id  as string | undefined) || null,
    vessel_or_flight:    (f.vessel_or_flight     as string | undefined) || null,
    voyage:              (f.voyage               as string | undefined) || null,
    origin_port_id:      (f.origin_port_id       as string | undefined) || null,
    destination_port_id: (f.destination_port_id  as string | undefined) || null,
    eta:                 (f.eta                  as string | undefined) || null,
    etd:                 (f.etd                  as string | undefined) || null,
    atd:                 (f.atd                  as string | undefined) || null,
    ata:                 (f.ata                  as string | undefined) || null,
    notes:               (f.notes                as string | undefined) || null,
    tracking_enabled:    f.tracking_enabled ?? false,
    tracking_provider:   (f.tracking_provider    as string | undefined) || null,
    tracking_ref:        (f.tracking_ref         as string | undefined) || null,
  }).eq("id", id);

  if (upErr) redirect(errUrl(back, "error_generico"));

  // Propagar cambios de itinerario a los houses si algo cambió
  const etaChanged     = f.eta              !== (existing.eta              ?? "");
  const etdChanged     = f.etd              !== (existing.etd              ?? "");
  const atdChanged     = f.atd              !== (existing.atd              ?? "");
  const ataChanged     = f.ata              !== (existing.ata              ?? "");
  const vesselChanged  = (f.vessel_or_flight as string || "") !== (existing.vessel_or_flight ?? "");
  const voyageChanged  = (f.voyage          as string || "") !== (existing.voyage            ?? "");

  if (etaChanged || etdChanged || atdChanged || ataChanged || vesselChanged || voyageChanged) {
    await supabase.rpc("update_master_schedule", {
      _tenant:            tenant.id,
      _master_id:         id,
      _eta:               etaChanged    ? ((f.eta              as string | undefined) || null) : null,
      _etd:               etdChanged    ? ((f.etd              as string | undefined) || null) : null,
      _atd:               atdChanged    ? ((f.atd              as string | undefined) || null) : null,
      _ata:               ataChanged    ? ((f.ata              as string | undefined) || null) : null,
      _vessel_or_flight:  vesselChanged ? ((f.vessel_or_flight as string | undefined) || null) : null,
      _voyage:            voyageChanged ? ((f.voyage           as string | undefined) || null) : null,
    });
  }

  // Activar tracking si se habilitó ahora
  const trackingJustEnabled =
    f.tracking_enabled && !existing.tracking_enabled &&
    f.tracking_ref && f.tracking_provider;

  if (trackingJustEnabled) {
    try {
      const provider = getTrackingProvider(f.tracking_provider as string);
      await provider.startTracking({
        id,
        tenant_id:         tenant.id,
        tracking_ref:      f.tracking_ref as string,
        tracking_provider: f.tracking_provider as string,
        mode:              f.mode,
      });
    } catch {
      // No bloquear la actualización si falla el registro en el proveedor
    }
  }

  revalidatePath("/masters");
  revalidatePath(`/masters/${id}`);
  redirect(okUrl(`/masters/${id}`, "master_actualizado"));
}

// ── Vincular embarque a master ────────────────────────────────────────────────
export async function linkShipment(formData: FormData) {
  const masterId   = str(formData, "master_id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(masterId) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl(`/masters/${masterId}?tab=houses`, "id_invalido"));
  }
  const back = `/masters/${masterId}?tab=houses`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = LinkShipmentSchema.safeParse({ master_id: masterId, shipment_id: shipmentId });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("link_shipment_to_master", {
    _tenant:      tenant.id,
    _shipment_id: shipmentId,
    _master_id:   masterId,
  });

  if (error) {
    const key: MsgKey = error.message.includes("mode_mismatch") ? "mode_incompatible"
      : error.message.includes("shipment_terminal")             ? "embarque_no_editable"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  revalidatePath(`/masters/${masterId}`);
  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "house_vinculado"));
}

// ── Desvincular embarque de master ────────────────────────────────────────────
export async function unlinkShipment(formData: FormData) {
  const masterId   = str(formData, "master_id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(masterId) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl(`/masters/${masterId}?tab=houses`, "id_invalido"));
  }
  const back = `/masters/${masterId}?tab=houses`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = UnlinkShipmentSchema.safeParse({ shipment_id: shipmentId });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("unlink_shipment_from_master", {
    _tenant:      tenant.id,
    _shipment_id: shipmentId,
  });

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath(`/masters/${masterId}`);
  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "house_desvinculado"));
}

// ── Vincular embarque desde la ficha del embarque ─────────────────────────────
export async function assignMasterToShipment(formData: FormData) {
  const masterId   = str(formData, "master_id");
  const shipmentId = str(formData, "shipment_id");
  if (!UUID_RE.test(masterId) || !UUID_RE.test(shipmentId)) {
    redirect(errUrl(`/embarques/${shipmentId}?tab=tracking`, "id_invalido"));
  }
  const back = `/embarques/${shipmentId}?tab=tracking`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = LinkShipmentSchema.safeParse({ master_id: masterId, shipment_id: shipmentId });
  if (!result.success) redirect(errUrl(back, "error_generico"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("link_shipment_to_master", {
    _tenant:      tenant.id,
    _shipment_id: shipmentId,
    _master_id:   masterId,
  });

  if (error) {
    const key: MsgKey = error.message.includes("mode_mismatch") ? "mode_incompatible"
      : "error_generico";
    redirect(errUrl(back, key));
  }

  revalidatePath(`/embarques/${shipmentId}`);
  redirect(okUrl(back, "house_vinculado"));
}

// ── Agregar evento de tracking manual ────────────────────────────────────────
export async function addManualTrackingEvent(formData: FormData) {
  const masterId = str(formData, "master_id");
  if (!UUID_RE.test(masterId)) redirect(errUrl("/masters", "id_invalido"));
  const back = `/masters/${masterId}?tab=tracking`;

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl(back, "empresa_suspendida"));

  const result = ManualTrackingEventSchema.safeParse({
    master_id:   masterId,
    event_code:  str(formData, "event_code"),
    event_label: str(formData, "event_label"),
    location:    str(formData, "location")    || undefined,
    occurred_at: str(formData, "occurred_at"),
  });

  if (!result.success) redirect(errUrl(back, "error_generico"));

  const f = result.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_tracking_event", {
    _tenant:      tenant.id,
    _master_id:   f.master_id,
    _provider:    "manual",
    _event_code:  f.event_code,
    _event_label: f.event_label,
    _location:    (f.location as string | undefined) || null,
    _occurred_at: f.occurred_at,
    _raw:         {},
  });

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath(`/masters/${masterId}`);
  redirect(okUrl(back, "tracking_evento_registrado"));
}

// ── Aceptar sugerencia de tracking ───────────────────────────────────────────
export async function acceptSuggestion(formData: FormData) {
  const masterId = str(formData, "master_id");
  if (!UUID_RE.test(masterId)) redirect(errUrl("/", "id_invalido"));

  const result = SuggestionActionSchema.safeParse({ master_id: masterId });
  if (!result.success) redirect(errUrl("/", "error_generico"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl("/", "empresa_suspendida"));

  const back = str(formData, "back") || `/masters/${masterId}?tab=tracking`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_tracking_suggestion", {
    _tenant:    tenant.id,
    _master_id: masterId,
  });

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath("/");
  revalidatePath(`/masters/${masterId}`);
  redirect(okUrl(back, "sugerencia_aceptada"));
}

// ── Descartar sugerencia de tracking ─────────────────────────────────────────
export async function dismissSuggestion(formData: FormData) {
  const masterId = str(formData, "master_id");
  if (!UUID_RE.test(masterId)) redirect(errUrl("/", "id_invalido"));

  const result = SuggestionActionSchema.safeParse({ master_id: masterId });
  if (!result.success) redirect(errUrl("/", "error_generico"));

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") redirect(errUrl("/", "empresa_suspendida"));

  const back = str(formData, "back") || `/masters/${masterId}?tab=tracking`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_tracking_suggestion", {
    _tenant:    tenant.id,
    _master_id: masterId,
  });

  if (error) redirect(errUrl(back, "error_generico"));

  revalidatePath("/");
  revalidatePath(`/masters/${masterId}`);
  redirect(okUrl(back, "sugerencia_descartada"));
}
