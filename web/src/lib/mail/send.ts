import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MsgKey } from "@/lib/messages";
import { checkLimit, emailUserLimiter, emailTenantLimiter } from "@/lib/rate-limit";
import { getResendClient } from "./resend";
import { createAdminClient } from "@/lib/supabase/admin";

type SendResult = { ok: true } | { ok: false; code: MsgKey };

export async function sendWithPdfAttachment(params: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  to: string;
  subject: string;
  body: string;
  pdfBytes: Uint8Array;
  pdfFilename: string;
  template: string;
  relatedType: string;
  relatedId: string;
}): Promise<SendResult> {
  const { supabase, tenantId, userId, pdfBytes, pdfFilename, template, relatedType, relatedId } =
    params;

  // 1. Rate limit por usuario
  if (!(await checkLimit(emailUserLimiter, userId))) {
    return { ok: false, code: "correo_limite" };
  }

  // 2. Rate limit por tenant
  if (!(await checkLimit(emailTenantLimiter, tenantId))) {
    return { ok: false, code: "correo_limite" };
  }

  // 3. Validar destinatario
  const emailParse = z.string().email().safeParse(params.to);
  if (!emailParse.success) {
    return { ok: false, code: "correo_error" };
  }
  const to = emailParse.data;

  // 4. Sanitizar asunto (prevenir header injection)
  const subject = params.subject.replace(/[\r\n]/g, " ").slice(0, 998);

  // 5. Verificar cliente Resend configurado
  const resend = getResendClient();
  if (!resend) {
    return { ok: false, code: "correo_no_configurado" };
  }

  const fromName = process.env.RESEND_FROM_NAME ?? "Clickargo";
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@clickargo.app";
  const from = `${fromName} <${fromEmail}>`;

  const bodyHtml = params.body
    ? `<p>${params.body.replace(/\n/g, "<br>")}</p>`
    : "";

  // 6. Enviar correo con PDF adjunto
  let providerMessageId: string | null = null;
  let sendError: string | null = null;
  let status: "sent" | "failed" = "failed";

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html: bodyHtml || "<p>Documento adjunto.</p>",
      attachments: [
        {
          filename: pdfFilename,
          content: Buffer.from(pdfBytes).toString("base64"),
        },
      ],
    });

    if (error || !data?.id) {
      sendError = error?.message ?? "Error desconocido";
    } else {
      providerMessageId = data.id;
      status = "sent";
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : "Error desconocido";
  }

  // 7. Registrar en outbound_emails (siempre, incluso en fallo)
  await supabase.from("outbound_emails").insert({
    tenant_id: tenantId,
    to_email: to,
    subject,
    template,
    related_type: relatedType,
    related_id: relatedId,
    status,
    provider_message_id: providerMessageId,
    error: sendError,
    created_by: userId,
  });

  // 8. Resultado
  if (status === "sent") return { ok: true };
  return { ok: false, code: "correo_error" };
}

type NotifKind = "stage_changed" | "eta_changed" | "document_added";

const NOTIF_SUBJECTS: Record<NotifKind, string> = {
  stage_changed:   "Actualización de tu embarque",
  eta_changed:     "Cambio de fecha estimada",
  document_added:  "Nuevo documento disponible",
};

/** Envía un correo de notificación al cliente del portal (sin adjunto, sin sesión de usuario). */
export async function sendNotificationEmail(params: {
  tenantId: string;
  to: string;
  shipmentNumber: string;
  kind: NotifKind;
  portalUrl: string;
  relatedId: string;
}): Promise<{ ok: boolean }> {
  const { tenantId, shipmentNumber, kind, portalUrl, relatedId } = params;

  const emailParse = z.string().email().safeParse(params.to);
  if (!emailParse.success) return { ok: false };
  const to = emailParse.data;

  if (!(await checkLimit(emailTenantLimiter, tenantId))) return { ok: false };

  const resend = getResendClient();
  if (!resend) return { ok: false };

  const fromName = process.env.RESEND_FROM_NAME ?? "Clickargo";
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@clickargo.app";
  const from = `${fromName} <${fromEmail}>`;
  const subject = `${NOTIF_SUBJECTS[kind]} ${shipmentNumber}`;

  const bodyHtml = `
    <p>Hola,</p>
    <p>Hay una actualización en tu embarque <strong>${shipmentNumber}</strong>.</p>
    <p><a href="${portalUrl}">Ver embarque en el portal</a></p>
  `;

  let status: "sent" | "failed" = "failed";
  let providerMessageId: string | null = null;
  let sendError: string | null = null;

  try {
    const { data, error } = await resend.emails.send({ from, to, subject, html: bodyHtml });
    if (error || !data?.id) {
      sendError = error?.message ?? "Error desconocido";
    } else {
      providerMessageId = data.id;
      status = "sent";
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : "Error desconocido";
  }

  // Usar admin client porque el cron no tiene sesión de usuario
  const admin = createAdminClient();
  await admin.from("outbound_emails").insert({
    tenant_id: tenantId,
    to_email: to,
    subject,
    template: "notification",
    related_type: "shipment",
    related_id: relatedId,
    status,
    provider_message_id: providerMessageId,
    error: sendError,
    created_by: null,
  });

  return { ok: status === "sent" };
}
