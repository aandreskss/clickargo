"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errUrl, okUrl, type MsgKey } from "@/lib/messages";
import { checkLimit, loginLimiter, signupLimiter } from "@/lib/rate-limit";

const ALLOWED_REDIRECTS = new Set(["/login", "/admin/login", "/"]);

function mapAuthError(message: string): MsgKey {
  if (/invalid login/i.test(message))      return "credenciales_invalidas";
  if (/already registered/i.test(message)) return "correo_existente";
  if (/password/i.test(message))           return "password_corta";
  if (/confirm/i.test(message))            return "sin_confirmacion";
  return "error_generico";
}

async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

export async function signIn(formData: FormData) {
  const from = String(formData.get("from") ?? "/");
  const loginPage = from === "/admin" ? "/admin/login" : "/login";

  const ip = await getClientIp();
  const allowed = await checkLimit(loginLimiter, `ip:${ip}`);
  if (!allowed) redirect(errUrl(loginPage, "error_generico"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email:    String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (error) redirect(errUrl(loginPage, mapAuthError(error.message)));
  redirect(from === "/admin" ? "/admin" : "/");
}

export async function signUp(formData: FormData) {
  const ip = await getClientIp();
  const allowed = await checkLimit(signupLimiter, `ip:${ip}`);
  if (!allowed) redirect(errUrl("/registro", "error_generico"));

  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();

  // Registro solo por invitación: comprobar antes de llamar a Supabase Auth.
  const { data: invites } = await supabase
    .from("tenant_invites")
    .select("id")
    .eq("email", email.toLowerCase())
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  if (!invites?.length) redirect(errUrl("/registro", "sin_invitacion"));

  const { data, error } = await supabase.auth.signUp({
    email,
    password: String(formData.get("password") ?? ""),
    options:  { data: { full_name: String(formData.get("full_name") ?? "").trim() } },
  });
  if (error) redirect(errUrl("/registro", mapAuthError(error.message)));
  if (!data.session) redirect(okUrl("/login", "revisa_correo"));
  redirect("/");
}

export async function signOut(formData: FormData) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const to = String(formData.get("to") ?? "/login");
  redirect(ALLOWED_REDIRECTS.has(to) ? to : "/login");
}
