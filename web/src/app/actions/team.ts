"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { revokeUserSessions } from "@/lib/supabase/admin";
import { tenantFromHost } from "@/lib/tenant";
import {
  InviteMemberSchema,
  ChangeRoleSchema,
  ToggleCanSeeCostsSchema,
  DeactivateMemberSchema,
} from "@/lib/schemas/team.schema";
import { errUrl, okUrl } from "@/lib/messages";
import { headers } from "next/headers";
import { checkLimit, inviteLimiter } from "@/lib/rate-limit";

const BASE = "/ajustes/equipo";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ── Contar owners activos (guarda "último owner") ─────────────────────────────
async function countActiveOwners(supabase: Awaited<ReturnType<typeof createClient>>, tenantId: string) {
  const { count } = await supabase
    .from("memberships")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .eq("is_active", true);
  return count ?? 0;
}

// ── Invitar miembro ───────────────────────────────────────────────────────────
export async function inviteMember(formData: FormData) {
  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const ok = await checkLimit(inviteLimiter, ip);
  if (!ok) redirect(errUrl(BASE, "invitacion_limite"));

  const parsed = InviteMemberSchema.safeParse({
    email: str(formData, "email"),
    role:  str(formData, "role"),
  });
  if (!parsed.success) redirect(errUrl(BASE, "error_generico"));
  const { email, role } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(BASE, "error_generico"));

  // Solo owner puede invitar a otro owner
  if (role === "owner") {
    const { data: m } = await supabase
      .from("memberships").select("role")
      .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
    if (m?.role !== "owner") redirect(errUrl(BASE, "sin_permiso_ajustes"));
  }

  const { error } = await supabase
    .from("tenant_invites")
    .insert({ tenant_id: tenant.id, email: email.toLowerCase(), role });

  if (error?.code === "23505") redirect(errUrl(BASE, "invitacion_ya_pendiente"));
  if (error) redirect(errUrl(BASE, "error_generico"));

  revalidatePath(BASE);
  redirect(okUrl(BASE, "invitacion_enviada"));
}

// ── Cambiar rol ───────────────────────────────────────────────────────────────
export async function changeRole(formData: FormData) {
  const parsed = ChangeRoleSchema.safeParse({
    membership_id: str(formData, "membership_id"),
    role:          str(formData, "role"),
  });
  if (!parsed.success) redirect(errUrl(BASE, "error_generico"));
  const { membership_id, role } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(BASE, "error_generico"));

  // Obtener membresía objetivo
  const { data: target } = await supabase
    .from("memberships").select("user_id, role")
    .eq("id", membership_id).eq("tenant_id", tenant.id).maybeSingle();
  if (!target) redirect(errUrl(BASE, "error_generico"));

  // No puede cambiar su propio rol
  if (target.user_id === user.id) redirect(errUrl(BASE, "no_auto_degradar"));

  // Si se degrada desde owner, verificar que queda al menos otro owner activo
  if (target.role === "owner" && role !== "owner") {
    const count = await countActiveOwners(supabase, tenant.id);
    if (count <= 1) redirect(errUrl(BASE, "ultimo_owner"));
  }

  const { error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("id", membership_id)
    .eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(BASE, "error_generico"));

  // Revocar sesiones para que el nuevo rol tome efecto inmediatamente
  await revokeUserSessions(target.user_id);

  revalidatePath(BASE);
  redirect(okUrl(BASE, "rol_cambiado"));
}

// ── Cambiar acceso a costos ───────────────────────────────────────────────────
export async function toggleCanSeeCosts(formData: FormData) {
  const parsed = ToggleCanSeeCostsSchema.safeParse({
    membership_id: str(formData, "membership_id"),
    can_see_costs: formData.get("can_see_costs") === "true",
  });
  if (!parsed.success) redirect(errUrl(BASE, "error_generico"));
  const { membership_id, can_see_costs } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { error } = await supabase
    .from("memberships")
    .update({ can_see_costs })
    .eq("id", membership_id)
    .eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(BASE, "error_generico"));

  revalidatePath(BASE);
  redirect(okUrl(BASE, "costos_actualizados"));
}

// ── Desactivar miembro ────────────────────────────────────────────────────────
export async function deactivateMember(formData: FormData) {
  const parsed = DeactivateMemberSchema.safeParse({
    membership_id: str(formData, "membership_id"),
  });
  if (!parsed.success) redirect(errUrl(BASE, "error_generico"));
  const { membership_id } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(BASE, "error_generico"));

  const { data: target } = await supabase
    .from("memberships").select("user_id, role")
    .eq("id", membership_id).eq("tenant_id", tenant.id).maybeSingle();
  if (!target) redirect(errUrl(BASE, "error_generico"));

  if (target.user_id === user.id) redirect(errUrl(BASE, "no_auto_degradar"));

  if (target.role === "owner") {
    const count = await countActiveOwners(supabase, tenant.id);
    if (count <= 1) redirect(errUrl(BASE, "ultimo_owner"));
  }

  const { error } = await supabase
    .from("memberships")
    .update({ is_active: false })
    .eq("id", membership_id)
    .eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(BASE, "error_generico"));

  await revokeUserSessions(target.user_id);

  revalidatePath(BASE);
  redirect(okUrl(BASE, "miembro_desactivado"));
}

// ── Reactivar miembro ─────────────────────────────────────────────────────────
export async function reactivateMember(formData: FormData) {
  const parsed = DeactivateMemberSchema.safeParse({
    membership_id: str(formData, "membership_id"),
  });
  if (!parsed.success) redirect(errUrl(BASE, "error_generico"));

  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { error } = await supabase
    .from("memberships")
    .update({ is_active: true })
    .eq("id", parsed.data.membership_id)
    .eq("tenant_id", tenant.id);

  if (error) redirect(errUrl(BASE, "error_generico"));

  revalidatePath(BASE);
  redirect(okUrl(BASE, "miembro_reactivado"));
}
