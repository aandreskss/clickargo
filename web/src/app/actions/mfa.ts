"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errUrl } from "@/lib/messages";

export async function enrollTotp(formData: FormData) {
  const supabase = await createClient();
  const friendlyName = String(formData.get("friendly_name") ?? "Autenticador");
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (error) redirect(errUrl("/mfa-setup", "error_generico"));
  // La página de setup lee el QR de los searchParams (totp_uri codificado).
  const uri = encodeURIComponent(data.totp.uri);
  redirect(`/mfa-setup?uri=${uri}&factorId=${data.id}`);
}

export async function verifyTotp(formData: FormData) {
  const supabase = await createClient();
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");

  // Paso 1: challenge
  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) redirect(errUrl("/mfa-verify", "error_generico"));

  // Paso 2: verify
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code,
  });
  if (verifyError) redirect(errUrl("/mfa-verify?factorId=" + factorId, "error_generico"));

  // Redirigir al inicio de la empresa (el layout leerá el slug del host).
  redirect("/");
}

export async function unenrollTotp(formData: FormData) {
  const supabase = await createClient();
  const factorId = String(formData.get("factorId") ?? "");
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) redirect(errUrl("/ajustes/seguridad", "error_generico"));
  redirect("/ajustes/seguridad");
}
