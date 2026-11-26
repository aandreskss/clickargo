import { createAdminClient } from "@/lib/supabase/admin";
import { getTrackingProvider } from "@/lib/tracking";

const MAX_BODY_BYTES = 512 * 1024; // 512 KB

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerName } = await params;

  // 1. Reject oversized payloads before reading body
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  // 2. Read body as text — required for HMAC verification
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  // 3. Verify HMAC signature before touching the database
  const trackingProvider = getTrackingProvider(providerName);
  const signatureHeader =
    request.headers.get("x-t49-hmac-sha256") ??
    request.headers.get("x-webhook-signature") ??
    "";

  if (!trackingProvider.verifySignature(body, signatureHeader)) {
    return Response.json({ error: "firma_webhook_invalida" }, { status: 401 });
  }

  // 4. Timestamp replay-attack check (± 5 minutes)
  const tsHeader = request.headers.get("x-webhook-timestamp");
  if (tsHeader) {
    const webhookTime = new Date(tsHeader).getTime();
    if (isNaN(webhookTime) || Math.abs(Date.now() - webhookTime) > 5 * 60 * 1000) {
      return Response.json({ error: "timestamp_webhook_invalido" }, { status: 401 });
    }
  }

  // 5. Parse events (raw body is never executed — stored as-is in tracking_events.raw)
  let events: Awaited<ReturnType<typeof trackingProvider.parseWebhook>>;
  try {
    events = await trackingProvider.parseWebhook(
      body,
      Object.fromEntries(request.headers.entries()),
    );
  } catch {
    return Response.json({ error: "parse_error" }, { status: 400 });
  }

  if (events.length === 0) {
    return Response.json({ ok: true });
  }

  // 6. Extract tracking_ref from payload to resolve master_id
  //    For Terminal49 webhooks, the tracking request number lives in
  //    data.attributes.request_number or included[].attributes.request_number
  //    We NEVER follow URLs from the payload (anti-SSRF).
  let trackingRef: string | null = null;
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    // Terminal49: data.attributes.request_number
    const attrs = (payload?.data as Record<string, unknown>)?.attributes as
      | Record<string, unknown>
      | undefined;
    if (typeof attrs?.request_number === "string") {
      trackingRef = attrs.request_number;
    }
    // Fallback: search included array for shipment_tracking type
    if (!trackingRef) {
      const included = payload?.included as Array<Record<string, unknown>> | undefined;
      const tracker = included?.find((r) => r.type === "shipment_tracking");
      const tAttrs = tracker?.attributes as Record<string, unknown> | undefined;
      if (typeof tAttrs?.request_number === "string") {
        trackingRef = tAttrs.request_number;
      }
    }
  } catch {
    // Cannot extract tracking_ref — skip silently; respond 200 so provider doesn't retry
    return Response.json({ ok: true, skipped: "no_tracking_ref" });
  }

  if (!trackingRef) {
    return Response.json({ ok: true, skipped: "no_tracking_ref" });
  }

  // 7. Resolve master_id from tracking_ref using admin client (no user session in webhook)
  const admin = createAdminClient();
  const { data: masters } = await admin
    .from("masters")
    .select("id, tenant_id")
    .eq("tracking_ref", trackingRef)
    .eq("tracking_enabled", true)
    .limit(5);

  if (!masters || masters.length === 0) {
    return Response.json({ ok: true, skipped: "no_master_found" });
  }

  // 8. Insert events for each matching master (admin client bypasses RLS; allowed per admin.ts)
  const inserted: string[] = [];
  for (const master of masters) {
    for (const ev of events) {
      const { error } = await admin.from("tracking_events").insert({
        tenant_id:   master.tenant_id,
        master_id:   master.id,
        provider:    ev.provider,
        event_code:  ev.event_code,
        event_label: ev.event_label,
        location:    ev.location ?? null,
        occurred_at: ev.occurred_at.toISOString(),
        raw:         ev.raw,
      });

      if (!error) {
        inserted.push(ev.event_code);
        // 9. Evaluate pending suggestion after each new event
        await admin.rpc("refresh_master_suggestion", {
          _master_id: master.id,
          _tenant_id: master.tenant_id,
        });
      }
      // ON CONFLICT (unique key) → Supabase returns 23505; ignore duplicates silently
    }
  }

  return Response.json({ ok: true, inserted: inserted.length });
}
