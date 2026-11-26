import Link from "next/link";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { STAGE_LABELS, STAGE_BADGE_COLORS, type BadgeColor } from "@/lib/field-packs";
import { createClient } from "@/lib/supabase/server";
import { acceptSuggestion, dismissSuggestion } from "@/app/actions/masters";

export default async function Inicio() {
  const supabase = await createClient();

  const today       = new Date().toISOString().split("T")[0];
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const fiveDaysAgo  = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: etaVencidos },
    { data: detenidos },
    { data: sinRespuesta },
    { data: borradores },
    { data: sugerencias },
  ] = await Promise.all([
    // 1. ETA vencida: eta pasada y no terminal
    supabase.from("shipments")
      .select("id, number, stage_key, eta, account_id")
      .lt("eta", today)
      .neq("stage_key", "completed")
      .neq("stage_key", "cancelled")
      .order("eta", { ascending: true })
      .limit(10),

    // 2. Detenidos: sin movimiento en 3+ días (excluye draft y terminales)
    supabase.from("shipments")
      .select("id, number, stage_key, updated_at, account_id")
      .lt("updated_at", threeDaysAgo)
      .neq("stage_key", "completed")
      .neq("stage_key", "cancelled")
      .neq("stage_key", "draft")
      .order("updated_at", { ascending: true })
      .limit(10),

    // 3. Cotizaciones enviadas sin respuesta en 5+ días
    supabase.from("quotes")
      .select("id, number, status, created_at, account_id")
      .eq("status", "sent")
      .lt("created_at", fiveDaysAgo)
      .order("created_at", { ascending: true })
      .limit(10),

    // 4. Embarques en borrador (aún sin completar)
    supabase.from("shipments")
      .select("id, number, stage_key, created_at, account_id")
      .eq("stage_key", "draft")
      .order("created_at", { ascending: false })
      .limit(10),

    // 5. Masters con sugerencia de tracking pendiente (RLS filtra por tenant del usuario)
    supabase.from("masters")
      .select("id, number, master_number, pending_suggestion_stage, pending_suggestion_at")
      .not("pending_suggestion_stage", "is", null)
      .order("pending_suggestion_at", { ascending: true })
      .limit(5),
  ]);

  // Cargar nombres de cuentas en batch
  const allAccountIds = [
    ...(etaVencidos  ?? []).map((r) => r.account_id),
    ...(detenidos    ?? []).map((r) => r.account_id),
    ...(sinRespuesta ?? []).map((r) => r.account_id),
    ...(borradores   ?? []).map((r) => r.account_id),
  ].filter(Boolean) as string[];

  const uniqueIds = [...new Set(allAccountIds)];
  const { data: accounts } = uniqueIds.length > 0
    ? await supabase.from("accounts").select("id, name").in("id", uniqueIds)
    : { data: [] as { id: string; name: string }[] };

  const accName = (aid: string | null | undefined) =>
    accounts?.find((a) => a.id === aid)?.name ?? "—";

  const allEmpty =
    !etaVencidos?.length &&
    !detenidos?.length &&
    !sinRespuesta?.length &&
    !borradores?.length &&
    !sugerencias?.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">¿Qué hago hoy?</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Lo que necesita tu atención ahora mismo.
        </p>
      </div>

      {allEmpty ? (
        <Card>
          <EmptyState
            title="Todo al día"
            description="No hay embarques vencidos, detenidos ni cotizaciones sin respuesta. ¡Buen trabajo!"
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* ETA vencida */}
          {(etaVencidos ?? []).length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-error)]">
                ETA vencida ({etaVencidos!.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {etaVencidos!.map((r) => (
                  <Link key={r.id} href={`/embarques/${r.id}`}>
                    <Card className="cursor-pointer transition hover:border-[var(--color-primary)]">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-[var(--color-text)]">{r.number}</p>
                          <p className="text-sm text-[var(--color-text-muted)]">{accName(r.account_id)}</p>
                        </div>
                        <Badge color={(STAGE_BADGE_COLORS[r.stage_key] ?? "default") as BadgeColor}>
                          {STAGE_LABELS[r.stage_key] ?? r.stage_key}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-[var(--color-error)]">
                        ETA: {r.eta}
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Detenidos */}
          {(detenidos ?? []).length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-warning)]">
                Detenidos — sin movimiento 3+ días ({detenidos!.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {detenidos!.map((r) => (
                  <Link key={r.id} href={`/embarques/${r.id}`}>
                    <Card className="cursor-pointer transition hover:border-[var(--color-primary)]">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-[var(--color-text)]">{r.number}</p>
                          <p className="text-sm text-[var(--color-text-muted)]">{accName(r.account_id)}</p>
                        </div>
                        <Badge color={(STAGE_BADGE_COLORS[r.stage_key] ?? "default") as BadgeColor}>
                          {STAGE_LABELS[r.stage_key] ?? r.stage_key}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                        Último movimiento: {new Date(r.updated_at).toLocaleDateString("es-DO")}
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Cotizaciones sin respuesta */}
          {(sinRespuesta ?? []).length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-warning)]">
                Cotizaciones sin respuesta 5+ días ({sinRespuesta!.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {sinRespuesta!.map((r) => (
                  <Link key={r.id} href={`/cotizaciones/${r.id}`}>
                    <Card className="cursor-pointer transition hover:border-[var(--color-primary)]">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-[var(--color-text)]">{r.number}</p>
                          <p className="text-sm text-[var(--color-text-muted)]">{accName(r.account_id)}</p>
                        </div>
                        <Badge color="warning">Enviada</Badge>
                      </div>
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                        Enviada el: {new Date(r.created_at).toLocaleDateString("es-DO")}
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Borradores */}
          {(borradores ?? []).length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Embarques en borrador ({borradores!.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {borradores!.map((r) => (
                  <Link key={r.id} href={`/embarques/${r.id}/paso/2`}>
                    <Card className="cursor-pointer transition hover:border-[var(--color-primary)]">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-[var(--color-text)]">{r.number}</p>
                          <p className="text-sm text-[var(--color-text-muted)]">{accName(r.account_id)}</p>
                        </div>
                        <Badge color="default">Borrador</Badge>
                      </div>
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                        Creado el: {new Date(r.created_at).toLocaleDateString("es-DO")}
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Sugerencias de tracking */}
          {(sugerencias ?? []).length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                Sugerencias del tracking ({sugerencias!.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {sugerencias!.map((m) => (
                  <Card key={m.id} className="border-[var(--color-primary)]/30">
                    <div className="mb-3">
                      <p className="font-semibold text-[var(--color-text)]">{m.number}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        MBL: {m.master_number}
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-text)]">
                        Avanzar a: <strong>{STAGE_LABELS[m.pending_suggestion_stage!] ?? m.pending_suggestion_stage}</strong>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <form action={acceptSuggestion}>
                        <input type="hidden" name="master_id" value={m.id} />
                        <input type="hidden" name="back" value="/" />
                        <Button type="submit">Aceptar</Button>
                      </form>
                      <form action={dismissSuggestion}>
                        <input type="hidden" name="master_id" value={m.id} />
                        <input type="hidden" name="back" value="/" />
                        <Button type="submit" variant="ghost">Descartar</Button>
                      </form>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}