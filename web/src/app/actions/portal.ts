"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, revokeUserSessions } from "@/lib/supabase/admin";
import { tenantFromHost } from "@/lib/tenant";
import { errUrl, okUrl } from "@/lib/messages";
import { checkLimit, inviteLimiter, loginLimiter } from "@/lib/rate-limit";
import { getResendClient } from "@/lib/mail/resend";
import {
  InvitePortalSchema,
  AcceptInvitationSchema,
  LoginPortalSchema,
  RevokePortalAccessSchema,
  TrackingLinkSchema,
  NotificationPrefsSchema,
} from "@/lib/schemas/portal.schema";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ── Invitar cliente al portal ──────────────────────────────────────────────

export async function inviteCustomerToPortal(formData: FormData) {
  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";

  const parsed = InvitePortalSchema.safeParse({
    account_id: str(formData, "account_id"),
    email:      str(formData, "email"),
  });
  if (!parsed.success) redirect(errUrl("/", "error_generico"));
  const { account_id, email } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl("/", "error_generico"));

  const BASE = `/clientes/${account_id}`;

  // Rate limit 5 invitaciones por tenant/hora
  if (!(await checkLimit(inviteLimiter, `portal:${tenant.id}`))) {
    redirect(errUrl(BASE, "invitacion_limite"));
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(BASE, "error_generico"));

  // Verificar rol manager+
  const { data: m } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!m || !["owner", "admin", "manager"].includes(m.role)) {
    redirect(errUrl(BASE, "sin_permiso_ajustes"));
  }

  // Generar token de 32 bytes: raw (no guardado), hash (guardado en BD)
  const rawToken  = randomBytes(32).toString("base64url");
  const tokenHash = sha256(rawToken);

  const { error } = await supabase.from("portal_invitations").insert({
    tenant_id:  tenant.id,
    account_id,
    email:      email.toLowerCase(),
    token_hash: tokenHash,
    invited_by: user.id,
  });

  if (error) redirect(errUrl(BASE, "error_generico"));

  // Enviar correo con el raw token (el correo incluye el enlace de aceptación)
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const acceptUrl  = `https://${tenant.slug}.${rootDomain}/portal-accept?t=${rawToken}`;

  const resend = getResendClient();
  if (resend) {
    const fromName  = process.env.RESEND_FROM_NAME  ?? "Clickargo";
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@clickargo.app";
    await resend.emails.send({
      from:    `${fromName} <${fromEmail}>`,
      to:      email.toLowerCase(),
      subject: `Invitación al portal de seguimiento — ${tenant.name ?? ""}`,
      html:    `<p>Te han invitado al portal de seguimiento.</p>
               <p><a href="${acceptUrl}">Crear tu contraseña y acceder</a></p>
               <p>Este enlace vence en 48 horas.</p>`,
    });
  }

  revalidatePath(BASE);
  redirect(okUrl(BASE, "invitacion_enviada"));
}

// ── Aceptar invitación (pública, sin sesión) ───────────────────────────────

export async function acceptPortalInvitation(formData: FormData) {
  const parsed = AcceptInvitationSchema.safeParse({
    token:    str(formData, "token"),
    password: str(formData, "password"),
  });
  // Misma respuesta para input inválido y token inválido (sin enumeración)
  if (!parsed.success) redirect(errUrl("/portal-accept", "invitacion_invalida"));
  const { token, password } = parsed.data;

  const tokenHash = sha256(token);
  const admin     = createAdminClient();

  // Buscar invitación válida (no aceptada, no expirada)
  const { data: inv } = await admin
    .from("portal_invitations")
    .select("id, tenant_id, account_id, email, accepted_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!inv || inv.accepted_at || new Date(inv.expires_at) < new Date()) {
    redirect(errUrl("/portal-accept", "invitacion_invalida"));
  }

  // Buscar o crear usuario en Supabase Auth
  // Intentamos crear primero; si ya existe (error de email duplicado), lo buscamos por REST
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email:         inv.email.toLowerCase(),
    password,
    email_confirm: true,
  });

  let userId: string;

  if (createErr) {
    // Usuario ya existía — buscar por email vía REST del admin de Supabase
    const lookupRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(inv.email.toLowerCase())}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        },
      },
    );
    if (!lookupRes.ok) redirect(errUrl("/portal-accept", "error_generico"));
    const lookupData = await lookupRes.json() as { users?: Array<{ id: string }> };
    const existingId = lookupData.users?.[0]?.id;
    if (!existingId) redirect(errUrl("/portal-accept", "error_generico"));
    userId = existingId;
  } else {
    if (!newUser?.user) redirect(errUrl("/portal-accept", "error_generico"));
    userId = newUser.user.id;
  }

  // Crear membresía con role='customer'
  const { error: memErr } = await admin.from("memberships").insert({
    tenant_id:  inv.tenant_id,
    user_id:    userId,
    account_id: inv.account_id,
    role:       "customer",
    is_active:  true,
  });

  // 23505 = membresía duplicada (ya es cliente de este tenant/account)
  if (memErr && memErr.code !== "23505") {
    redirect(errUrl("/portal-accept", "error_generico"));
  }

  // Marcar invitación como aceptada
  await admin
    .from("portal_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", inv.id);

  redirect(okUrl("/portal-login", "invitacion_enviada"));
}

// ── Login del portal (pública, sin sesión) ─────────────────────────────────

export async function loginPortal(formData: FormData) {
  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  if (!(await checkLimit(loginLimiter, ip))) {
    redirect(errUrl("/portal-login", "credenciales_invalidas"));
  }

  const parsed = LoginPortalSchema.safeParse({
    email:    str(formData, "email"),
    password: str(formData, "password"),
  });
  if (!parsed.success) redirect(errUrl("/portal-login", "credenciales_invalidas"));
  const { email, password } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl("/portal-login", "error_generico"));

  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) redirect(errUrl("/portal-login", "credenciales_invalidas"));

  // Verificar que el usuario tiene membresía activa de tipo customer en este tenant
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl("/portal-login", "credenciales_invalidas"));

  const { data: m } = await supabase
    .from("memberships")
    .select("role, is_active")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .eq("role", "customer")
    .maybeSingle();

  if (!m || !m.is_active) {
    await supabase.auth.signOut();
    redirect(errUrl("/portal-login", "credenciales_invalidas"));
  }

  redirect("/portal");
}

// ── Revocar acceso al portal ───────────────────────────────────────────────

export async function revokePortalAccess(formData: FormData) {
  const parsed = RevokePortalAccessSchema.safeParse({
    membership_id: str(formData, "membership_id"),
  });
  if (!parsed.success) redirect(errUrl("/", "error_generico"));
  const { membership_id } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl("/", "error_generico"));

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl("/", "error_generico"));

  const { data: requester } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!requester || !["owner", "admin", "manager"].includes(requester.role)) {
    redirect(errUrl("/", "sin_permiso_ajustes"));
  }

  const { data: target } = await supabase
    .from("memberships")
    .select("user_id, account_id")
    .eq("id", membership_id)
    .eq("tenant_id", tenant.id)
    .eq("role", "customer")
    .maybeSingle();

  if (!target) redirect(errUrl("/", "error_generico"));

  await supabase
    .from("memberships")
    .update({ is_active: false })
    .eq("id", membership_id);

  await revokeUserSessions(target.user_id);

  const BASE = `/clientes/${target.account_id}`;
  revalidatePath(BASE);
  redirect(okUrl(BASE, "portal_acceso_revocado"));
}

// ── Generar enlace público de seguimiento ──────────────────────────────────

export async function generateTrackingLink(formData: FormData) {
  const parsed = TrackingLinkSchema.safeParse({
    shipment_id: str(formData, "shipment_id"),
  });
  if (!parsed.success) redirect(errUrl("/", "error_generico"));
  const { shipment_id } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl("/", "error_generico"));

  const BASE = `/embarques/${shipment_id}`;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl(BASE, "error_generico"));

  const rawToken  = randomBytes(32).toString("base64url");
  const tokenHash = sha256(rawToken);

  // UPSERT: reemplaza enlace anterior si ya existía para este embarque
  const { error } = await supabase.from("tracking_links").upsert(
    {
      tenant_id:   tenant.id,
      shipment_id,
      token_hash:  tokenHash,
      revoked_at:  null,
      expires_at:  null,
      created_by:  user.id,
    },
    { onConflict: "tenant_id,shipment_id" },
  );

  if (error) redirect(errUrl(BASE, "error_generico"));

  revalidatePath(BASE);
  // Incluir el raw token en el redirect para mostrarlo una sola vez al staff.
  // El token NO se guarda en BD; esta es la única oportunidad de compartirlo.
  redirect(`${BASE}?ok=enlace_generado&tracking_token=${rawToken}`);
}

// ── Revocar enlace de seguimiento ──────────────────────────────────────────

export async function revokeTrackingLink(formData: FormData) {
  const parsed = TrackingLinkSchema.safeParse({
    shipment_id: str(formData, "shipment_id"),
  });
  if (!parsed.success) redirect(errUrl("/", "error_generico"));
  const { shipment_id } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl("/", "error_generico"));

  const BASE = `/embarques/${shipment_id}`;

  const { error } = await supabase
    .from("tracking_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", tenant.id)
    .eq("shipment_id", shipment_id);

  if (error) redirect(errUrl(BASE, "error_generico"));

  revalidatePath(BASE);
  redirect(okUrl(BASE, "enlace_revocado"));
}

// ── Guardar preferencias de notificación ───────────────────────────────────

export async function upsertNotificationPreferences(formData: FormData) {
  const parsed = NotificationPrefsSchema.safeParse({
    account_id: str(formData, "account_id"),
    kind:       str(formData, "kind"),
    enabled:    str(formData, "enabled"),
    emails:     str(formData, "emails"),
  });
  if (!parsed.success) redirect(errUrl("/ajustes/notificaciones", "error_generico"));
  const { account_id, kind, enabled, emails } = parsed.data;

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) redirect(errUrl("/ajustes/notificaciones", "error_generico"));

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(errUrl("/ajustes/notificaciones", "error_generico"));

  const { data: m } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!m || !["owner", "admin", "manager"].includes(m.role)) {
    redirect(errUrl("/ajustes/notificaciones", "sin_permiso_ajustes"));
  }

  const { error } = await supabase.from("notification_preferences").upsert(
    { tenant_id: tenant.id, account_id, event_kind: kind, enabled, emails },
    { onConflict: "tenant_id,account_id,event_kind" },
  );

  if (error) redirect(errUrl("/ajustes/notificaciones", "error_generico"));

  revalidatePath("/ajustes/notificaciones");
  redirect(okUrl("/ajustes/notificaciones", "prefs_guardadas"));
}
