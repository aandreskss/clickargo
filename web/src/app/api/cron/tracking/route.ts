import { createAdminClient } from "@/lib/supabase/admin";
import { getTrackingProvider } from "@/lib/tracking";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  // 1. Authenticate cron request with CRON_SECRET
  const auth = request.headers.get("authorization") ?? "";
  const secret = env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().split("T")[0];
  const staleThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  // 2. Fetch masters that need polling:
  //    - tracking enabled
  //    - ETA is today or in the future (or no ETA set, meaning we can't skip them)
  //    - last_tracked_at is null or stale (> 6 hours ago)
  const { data: masters, error: fetchErr } = await admin
    .from("masters")
    .select("id, tenant_id, tracking_ref, tracking_provider, mode")
    .eq("tracking_enabled", true)
    .or(`eta.gte.${today},eta.is.null`)
    .or(`last_tracked_at.is.null,last_tracked_at.lt.${staleThreshold}`)
    .limit(100);

  if (fetchErr) {
    console.error("[cron/tracking] fetch masters error:", fetchErr.message);
    return Response.json({ error: "db_error" }, { status: 500 });
  }

  if (!masters || masters.length === 0) {
    return Response.json({ updated: 0, errors: [] });
  }

  let updated = 0;
  const errors: Array<{ master_id: string; message: string }> = [];

  for (const master of masters) {
    try {
      const provider = getTrackingProvider(master.tracking_provider);
      const events = await provider.poll({
        id:                master.id,
        tenant_id:         master.tenant_id,
        tracking_ref:      master.tracking_ref,
        tracking_provider: master.tracking_provider,
        mode:              master.mode as "ocean" | "air",
      });

      for (const ev of events) {
        const { error: insErr } = await admin.from("tracking_events").insert({
          tenant_id:   master.tenant_id,
          master_id:   master.id,
          provider:    ev.provider,
          event_code:  ev.event_code,
          event_label: ev.event_label,
          location:    ev.location ?? null,
          occurred_at: ev.occurred_at.toISOString(),
          raw:         ev.raw,
        });

        if (!insErr) {
          // Refresh suggestion after inserting new event
          await admin.rpc("refresh_master_suggestion", {
            _master_id: master.id,
            _tenant_id: master.tenant_id,
          });
        }
        // 23505 (unique violation) → duplicate event, ignore silently
      }

      // 3. Update last_tracked_at regardless of whether events were found
      await admin
        .from("masters")
        .update({ last_tracked_at: new Date().toISOString() })
        .eq("id", master.id);

      updated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/tracking] master ${master.id}:`, message);
      errors.push({ master_id: master.id, message });
    }
  }

  return Response.json({ updated, errors });
}
