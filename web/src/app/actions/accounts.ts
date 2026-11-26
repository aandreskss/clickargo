"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { packFor } from "@/lib/field-packs";
import { AccountSchema } from "@/lib/schemas/account.schema";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function zodKey(msg: string): MsgKey {
  if (/nombre/i.test(msg)) return "nombre_obligatorio";
  if (/correo/i.test(msg)) return "correo_invalido";
  if (/tipo/i.test(msg)) return "tipo_invalido";
  return "error_generico";
}

async function parse(formData: FormData, back: string) {
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");

  if (tenant.status === "suspended") {
    redirect(errUrl(back, "empresa_suspendida"));
  }

  const parsed = AccountSchema.safeParse({
    kind:   str(formData, "kind"),
    name:   str(formData, "name"),
    tax_id: str(formData, "tax_id"),
    email:  str(formData, "email"),
    phone:  str(formData, "phone"),
  });
  if (!parsed.success) {
    redirect(errUrl(back, zodKey(parsed.error.issues[0]?.message ?? "")));
  }

  const { kind, name, email, phone, tax_id: rawTaxId } = parsed.data;

  const pack = packFor(tenant.country);
  const taxId = pack.normalizeTaxId(rawTaxId ?? "");
  if (taxId === null) redirect(errUrl(back, "id_fiscal_invalido"));

  const data: Record<string, string> = {};
  for (const f of pack.fields) {
    const v = str(formData, `data_${f.key}`);
    if (v) data[f.key] = v;
  }

  const supabase = await createClient();
  return {
    supabase,
    tenantId: tenant.id as string,
    row: { kind, name, tax_id: taxId || null, email: email || null, phone: phone || null, data },
  };
}

export async function createAccount(formData: FormData) {
  const { supabase, tenantId, row } = await parse(formData, "/clientes/nuevo");
  const { error } = await supabase.from("accounts").insert({ ...row, tenant_id: tenantId });
  if (error) {
    const key: MsgKey = /row-level security/i.test(error.message) ? "sin_permiso_crear" : "error_generico";
    redirect(errUrl("/clientes/nuevo", key));
  }
  revalidatePath("/clientes");
  redirect(okUrl("/clientes", "cuenta_guardada"));
}

export async function updateAccount(formData: FormData) {
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(errUrl("/clientes", "id_invalido"));
  const { supabase, row } = await parse(formData, `/clientes/${id}`);
  const { data, error } = await supabase.from("accounts").update(row).eq("id", id).select("id");
  if (error || !data?.length) redirect(errUrl(`/clientes/${id}`, "sin_permiso_editar"));
  revalidatePath("/clientes");
  redirect(okUrl("/clientes", "cuenta_actualizada"));
}

export async function deleteAccount(formData: FormData) {
  const id = str(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(errUrl("/clientes", "id_invalido"));
  const tenant = await tenantFromHost();
  if (!tenant) redirect("/");
  if (tenant.status === "suspended") {
    redirect(errUrl(`/clientes/${id}`, "empresa_suspendida"));
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("accounts").delete().eq("id", id).select("name");
  if (error || !data?.length) {
    redirect(errUrl(`/clientes/${id}`, "sin_permiso_eliminar"));
  }
  revalidatePath("/clientes");
  redirect(okUrl("/clientes", "cuenta_eliminada"));
}
