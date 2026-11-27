import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/mail/send";
import { env } from "@/lib/env";

const BATCH_SIZE   = 50;
const MAX_ATTEMPTS = 3;

function retryDelayMs(attempts: number): number {
  return attempts * 5 * 60 * 1000; // 5 min, 10 min, 15 min
}

export async function GET(request: Request) {
  const auth   = request.headers.get("authorization") ?? "";
  const secret = env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: items, error: fetchErr } = await admin
    .from("notification_queue")
    .select("id, tenant_id, kind, shipment_id, account_id, payload, attempts")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[cron/notifications] fetch error:", fetchErr.message);
    return Response.json({ error: "db_error" }, { status: 500 });
  }

  if (!items || items.length === 0) {
    return Response.json({ sent: 0 });
  }

  let sent = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      // Buscar preferencias de la cuenta (puede haber sido deshabilitado después de encolar)
      const { data: pref } = await admin
        .from("notification_preferences")
        .select("enabled, emails")
        .eq("tenant_id", item.tenant_id)
        .eq("account_id", item.account_id)
        .eq("event_kind", item.kind)
        .maybeSingle();

      if (!pref || !pref.enabled || !pref.emails?.length) {
        // Preferencia deshabilitada: marcar como enviado sin enviar correo
        await admin
          .from("notification_queue")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", item.id);
        sent++;
        continue;
      }

      // Buscar número del embarque y tenant slug para el enlace al portal
      const [{ data: ship }, { data: tenant }] = await Promise.all([
        admin.from("shipments").select("number").eq("id", item.shipment_id).maybeSingle(),
        admin.from("tenants").select("slug").eq("id", item.tenant_id).maybeSingle(),
      ]);

      const shipmentNumber = ship?.number ?? "—";
      const rootDomain     = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
      const portalUrl      = tenant
        ? `https://${tenant.slug}.${rootDomain}/portal/embarques/${item.shipment_id}`
        : `https://${rootDomain}`;

      let allOk = true;
      for (const email of pref.emails) {
        const result = await sendNotificationEmail({
          tenantId: item.tenant_id,
          to:       email,
          shipmentNumber,
          kind:     item.kind as "stage_changed" | "eta_changed" | "document_added",
          portalUrl,
          relatedId: item.shipment_id,
        });
        if (!result.ok) {
          allOk = false;
          errors.push(`${item.id}:${email} failed`);
        }
      }

      if (allOk) {
        await admin
          .from("notification_queue")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", item.id);
        sent++;
      } else {
        const newAttempts = item.attempts + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
          await admin
            .from("notification_queue")
            .update({ status: "failed", attempts: newAttempts, error_msg: "max_attempts" })
            .eq("id", item.id);
        } else {
          const nextAt = new Date(Date.now() + retryDelayMs(newAttempts)).toISOString();
          await admin
            .from("notification_queue")
            .update({ attempts: newAttempts, scheduled_at: nextAt })
            .eq("id", item.id);
        }
      }
    } catch (err) {
      errors.push(`${item.id}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  return Response.json({ sent, errors: errors.length, batch: items.length });
}
