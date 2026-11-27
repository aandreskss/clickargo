import { createHash } from "crypto";
import { headers } from "next/headers";
import { Badge, Card, EmptyState } from "@/components/ui";
import { STAGE_LABELS, STAGE_BADGE_COLORS } from "@/lib/field-packs";
import { createClient } from "@/lib/supabase/server";
import { checkLimit, publicTrackingLimiter } from "@/lib/rate-limit";

type TrackingEvent = {
  kind:        string;
  note:        string | null;
  occurred_at: string;
};

type TrackingResult = {
  shipment_number: string;
  stage_key:       string;
  mode:            string | null;
  origin_port_id:  string | null;
  dest_port_id:    string | null;
  eta:             string | null;
  events:          TrackingEvent[] | null;
};

export default async function SeguimientoPublico({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { token } = await params;

  // Rate limit por IP: 20 req/min
  const reqHeaders = await headers();
  const ip  = reqHeaders.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const ok  = await checkLimit(publicTrackingLimiter, ip);

  if (!ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
        <Card>
          <p className="text-center text-sm text-[var(--color-text-muted)]">
            Demasiadas solicitudes. Espera un momento e intenta de nuevo.
          </p>
        </Card>
      </main>
    );
  }

  // sha256 del token raw (misma respuesta para cualquier error)
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const supabase  = await createClient();

  const { data } = await supabase.rpc("get_tracking_shipment", { _token_hash: tokenHash });
  const result = (data as TrackingResult[] | null)?.[0] ?? null;

  if (!result) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
        <Card>
          <EmptyState
            title="Enlace no encontrado"
            description="El enlace de seguimiento no existe, ha vencido o fue desactivado."
          />
        </Card>
      </main>
    );
  }

  const events: TrackingEvent[] = Array.isArray(result.events) ? result.events : [];

  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            Embarque {result.shipment_number}
          </h1>
          {(result.origin_port_id || result.dest_port_id) && (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {result.origin_port_id} → {result.dest_port_id}
            </p>
          )}
        </div>

        <Card>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium uppercase text-[var(--color-text-muted)]">Etapa</p>
              <Badge color={STAGE_BADGE_COLORS[result.stage_key] ?? "default"}>
                {STAGE_LABELS[result.stage_key] ?? result.stage_key}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-[var(--color-text-muted)]">ETA</p>
              <p className="mt-1 text-sm font-medium">{result.eta ?? "—"}</p>
            </div>
          </div>
        </Card>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Seguimiento</h2>
          {events.length === 0 ? (
            <Card>
              <EmptyState title="Sin actualizaciones" description="Aún no hay eventos registrados para este embarque." />
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-[var(--color-border)]">
                {events.map((e, i) => (
                  <li key={i} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{STAGE_LABELS[e.kind] ?? e.kind}</p>
                        {e.note && (
                          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{e.note}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                        {new Date(e.occurred_at).toLocaleDateString("es-DO", {
                          year: "numeric", month: "short", day: "numeric",
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
