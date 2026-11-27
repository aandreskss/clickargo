"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errUrl } from "@/lib/messages";

function tenantBase(formData: FormData): string {
  const base = String(formData.get("base") ?? "");
  return /^\/t\/[a-z0-9-]+$/.test(base) ? base : "";
}

export async function enrollTotp(formData: FormData) {
  const base = tenantBase(formData);
  const setupPage = base ? `${base}/mfa-setup` : "/mfa-setup";
  const supabase = await createClient();
  const friendlyName = String(formData.get("friendly_name") ?? "Autenticador");
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (error) redirect(errUrl(setupPage, "error_generico"));
  const uri = encodeURIComponent(data.totp.uri);
  redirect(`${setupPage}?uri=${uri}&factorId=${data.id}&base=${encodeURIComponent(base)}`);
}

export async function verifyTotp(formData: FormData) {
  const base = tenantBase(formData);
  const verifyPage = base ? `${base}/mfa-verify` : "/mfa-verify";
  const supabase = await createClient();
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");

  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) redirect(errUrl(verifyPage, "error_generico"));

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code,
  });
  if (verifyError) redirect(errUrl(`${verifyPage}?factorId=${factorId}`, "error_generico"));

  redirect(base ? `${base}/` : "/");
}

export async function enrollTotpAdmin(formData: FormData) {
  const supabase = await createClient();
  const friendlyName = String(formData.get("friendly_name") ?? "Autenticador");
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName });
  if (error) redirect(errUrl("/admin/mfa-setup", "error_generico"));
  const uri = encodeURIComponent(data.totp.uri);
  redirect(`/admin/mfa-setup?uri=${uri}&factorId=${data.id}`);
}

export async function verifyTotpAdmin(formData: FormData) {
  const supabase = await createClient();
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) redirect(errUrl("/admin/mfa-verify", "error_generico"));
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code,
  });
  if (verifyError) redirect(errUrl(`/admin/mfa-verify?factorId=${factorId}`, "error_generico"));
  redirect("/admin");
}

export async function unenrollTotp(formData: FormData) {
  const supabase = await createClient();
  const factorId = String(formData.get("factorId") ?? "");
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) redirect(errUrl("/ajustes/seguridad", "error_generico"));
  redirect("/ajustes/seguridad");
}
