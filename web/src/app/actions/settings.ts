"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import {
  UpdateTenantSchema,
  UpdateCounterSchema,
  CreateChargeTypeSchema,
  UpdateChargeTypeSchema,
} from "@/lib/schemas/settings.schema";
import { errUrl, okUrl } from "@/lib/messages";

const BASE_EMP = "/ajustes/empresa";
const BASE_NUM = "/ajustes/numeracion";
const BASE_CAR = "/ajustes/cargos";

const str  = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ── Actualizar datos de la empresa ────────────────────────────────────────────
export async function updateTenantSettings(formData: FormData) {
  const parsed = UpdateTenantSchema.safeParse({
    name:               str(formData, "name"),
    tax_id:             str(formData, "tax_id"),
    address:            str(formData, "address"),
    phone:              str(formData, "phone"),
    contact_email:      str(formData, "contact_email"),
    secondary_currency: str(formData, "secondary_currency"),
    exchange_rate:      str(formData, "exchange_rate"),
  });
  if (!parsed.success) redirect(errUrl(BASE_EMP, "error_generico"));

  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { error } = await supabase
    .from("tenants")
    .update({
      name:               parsed.data.name,
      tax_id:             parsed.data.tax_id   || null,
      address:            parsed.data.address  || null,
      phone:              parsed.data.phone    || null,
      contact_email:      parsed.data.contact_email || null,
      secondary_currency: parsed.data.secondary_currency,
      exchange_rate:      parsed.data.exchange_rate,
    })
    .eq("id", tenant.id);

  if (error) redirect(errUrl(BASE_EMP, "error_generico"));

  revalidatePath(BASE_EMP);
  redirect(okUrl(BASE_EMP, "ajustes_guardados"));
}

// ── Subir logo ────────────────────────────────────────────────────────────────
// Firma real de los formatos permitidos
function detectImageType(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  return null;
}

export async function uploadLogo(formData: FormData) {
  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) redirect(errUrl(BASE_EMP, "error_generico"));

  if (file.size > 2 * 1024 * 1024) redirect(errUrl(BASE_EMP, "logo_muy_grande"));

  const buffer  = await file.arrayBuffer();
  const bytes   = new Uint8Array(buffer);
  const imgType = detectImageType(bytes);
  if (!imgType) redirect(errUrl(BASE_EMP, "logo_firma_invalida"));

  const mimeOk = ["image/png","image/jpeg","image/webp"].includes(file.type);
  if (!mimeOk) redirect(errUrl(BASE_EMP, "logo_tipo_invalido"));

  const contentType: Record<string, string> = {
    png: "image/png", jpeg: "image/jpeg", webp: "image/webp",
  };

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  const path     = `${tenant.id}/branding/logo.${imgType}`;

  const { error: uploadError } = await supabase.storage
    .from("tenant-assets")
    .upload(path, bytes, { contentType: contentType[imgType], upsert: true });

  if (uploadError) redirect(errUrl(BASE_EMP, "error_generico"));

  const { data: { publicUrl } } = supabase.storage
    .from("tenant-assets")
    .getPublicUrl(path);

  // El bucket es privado → usamos getPublicUrl solo como referencia; en la UI
  // se obtendrá una URL firmada al momento de mostrar.
  await supabase.from("tenants").update({ logo_url: path }).eq("id", tenant.id);

  revalidatePath(BASE_EMP);
  redirect(okUrl(BASE_EMP, "logo_subido"));
}

// ── Actualizar contador de numeración ─────────────────────────────────────────
export async function updateCounter(formData: FormData) {
  const parsed = UpdateCounterSchema.safeParse({
    key:        str(formData, "key"),
    prefix:     str(formData, "prefix"),
    next_value: str(formData, "next_value"),
  });
  if (!parsed.success) redirect(errUrl(BASE_NUM, "error_generico"));
  const { key, prefix, next_value } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  // tenant_counters no tiene política directa; usamos next_number para leer
  // el valor actual, pero la actualización del prefijo va en una tabla aparte.
  // Por ahora almacenamos prefijo y valor en tenant_counters usando upsert.
  // La clave compuesta: tenant_id + key ("{prefix}:{next_value}" se guarda en value).
  // Separamos prefijo y valor: guardamos el prefijo en settings jsonb del tenant.
  const { data: curTenant } = await supabase
    .from("tenants").select("settings").eq("id", tenant.id).maybeSingle();

  const settings = (curTenant?.settings ?? {}) as Record<string, unknown>;
  const counters = (settings.counters ?? {}) as Record<string, unknown>;
  counters[key] = { prefix, next_value: next_value - 1 };
  settings.counters = counters;

  const { error } = await supabase
    .from("tenants").update({ settings }).eq("id", tenant.id);

  if (error) redirect(errUrl(BASE_NUM, "error_generico"));

  revalidatePath(BASE_NUM);
  redirect(okUrl(BASE_NUM, "contador_actualizado"));
}

// ── Crear tipo de cargo ───────────────────────────────────────────────────────
export async function createChargeType(formData: FormData) {
  const parsed = CreateChargeTypeSchema.safeParse({
    code:         str(formData, "code"),
    name:         str(formData, "name"),
    default_unit: str(formData, "default_unit"),
    taxable:      formData.get("taxable") === "true",
  });
  if (!parsed.success) redirect(errUrl(BASE_CAR, "error_generico"));

  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { error } = await supabase.from("charge_types").insert({
    tenant_id:    tenant.id,
    code:         parsed.data.code,
    name:         parsed.data.name,
    default_unit: parsed.data.default_unit || null,
    taxable:      parsed.data.taxable,
  });

  if (error?.code === "23505") redirect(errUrl(BASE_CAR, "error_generico"));
  if (error) redirect(errUrl(BASE_CAR, "error_generico"));

  revalidatePath(BASE_CAR);
  redirect(okUrl(BASE_CAR, "cargo_guardado"));
}

// ── Actualizar tipo de cargo ──────────────────────────────────────────────────
export async function updateChargeType(formData: FormData) {
  const parsed = UpdateChargeTypeSchema.safeParse({
    id:           str(formData, "id"),
    code:         str(formData, "code"),
    name:         str(formData, "name"),
    default_unit: str(formData, "default_unit"),
    taxable:      formData.get("taxable") === "true",
  });
  if (!parsed.success) redirect(errUrl(BASE_CAR, "error_generico"));

  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { error } = await supabase.from("charge_types").update({
    code:         parsed.data.code,
    name:         parsed.data.name,
    default_unit: parsed.data.default_unit || null,
    taxable:      parsed.data.taxable,
  }).eq("id", parsed.data.id).eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(BASE_CAR, "error_generico"));

  revalidatePath(BASE_CAR);
  redirect(okUrl(BASE_CAR, "cargo_guardado"));
}

// ── Desactivar tipo de cargo ──────────────────────────────────────────────────
export async function deactivateChargeType(formData: FormData) {
  const id = str(formData, "id");
  if (!id) redirect(errUrl(BASE_CAR, "error_generico"));

  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { error } = await supabase.from("charge_types")
    .update({ active: false })
    .eq("id", id)
    .eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(BASE_CAR, "error_generico"));

  revalidatePath(BASE_CAR);
  redirect(okUrl(BASE_CAR, "cargo_desactivado"));
}

// ── Sembrar cargos por defecto ────────────────────────────────────────────────
export async function seedChargeTypes() {
  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { error } = await supabase.rpc("seed_default_charge_types", {
    _tenant: tenant.id,
  });

  if (error) redirect(errUrl(BASE_CAR, "error_generico"));

  revalidatePath(BASE_CAR);
  redirect(okUrl(BASE_CAR, "cargos_sembrados"));
}
