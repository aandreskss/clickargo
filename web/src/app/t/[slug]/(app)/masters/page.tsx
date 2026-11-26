import Link from "next/link";
import { Badge, Button, Card, EmptyState, Table, Td, Tr } from "@/components/ui";
import { STAGE_LABELS, STAGE_BADGE_COLORS, SHIPMENT_MODES, type BadgeColor } from "@/lib/field-packs";
import { createClient } from "@/lib/supabase/server";

export default async function MastersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const { slug } = await params;
  const { q = "", mode = "" } = await searchParams;

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  type MasterRow = {
    id: string; number: string; master_number: string; mode: string;
    vessel_or_flight: string | null; voyage: string | null; eta: string | null;
    stage_key: string | null; tracking_enabled: boolean; tracking_provider: string | null;
  };
  const { data: mastersRaw } = await supabase.rpc("search_masters", {
    _tenant: tenant.id,
    _q:      q.trim() || null,
    _mode:   mode || null,
    _limit:  50,
  });
  const masters = mastersRaw as MasterRow[] | null;

  const modeLabel = (m: string) =>
    SHIPMENT_MODES.find((x) => x.value === m)?.label ?? m ?? "—";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Masters</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            BL maestros que agrupan embarques (houses).
          </p>
        </div>
        <Link href="/masters/nuevo">
          <Button>+ Nuevo master</Button>
        </Link>
      </div>

      {/* Filtros */}
      <form method="GET" className="flex flex-wrap gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por número o MBL/MAWB…"
          className="flex-1 min-w-48 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
        />
        <select
          name="mode"
          defaultValue={mode}
          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none"
        >
          <option value="">Todos los modos</option>
          {SHIPMENT_MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary">Buscar</Button>
        {(q || mode) && (
          <Link href="/masters">
            <Button type="button" variant="ghost">Limpiar</Button>
          </Link>
        )}
      </form>

      {!masters || masters.length === 0 ? (
        <Card>
          <EmptyState
            title={q || mode ? "Sin resultados" : "Aún no hay masters"}
            description={
              q || mode
                ? "Prueba con otros términos de búsqueda."
                : "Crea un master para agrupar embarques bajo un mismo BL o guía aérea."
            }
            action={
              !q && !mode
                ? { label: "Crear primer master", href: "/masters/nuevo" }
                : undefined
            }
          />
        </Card>
      ) : (
        <Card className="p-0">
          <Table cols={["Número", "MBL / MAWB", "Buque / Vuelo", "ETA", "Etapa", "Tracking"]}>
            {masters.map((m) => {
              const badgeColor = (STAGE_BADGE_COLORS[m.stage_key ?? "draft"] ?? "default") as BadgeColor;
              const stageLabel = STAGE_LABELS[m.stage_key ?? "draft"] ?? (m.stage_key ?? "Borrador");
              return (
                <Tr key={m.id}>
                  <Td>
                    <Link
                      href={`/masters/${m.id}`}
                      className="font-semibold text-[var(--color-primary)] hover:underline"
                    >
                      {m.number}
                    </Link>
                  </Td>
                  <Td>
                    <div className="font-mono text-sm">{m.master_number}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{modeLabel(m.mode)}</div>
                  </Td>
                  <Td>
                    {m.vessel_or_flight ? (
                      <div>
                        <div>{m.vessel_or_flight}</div>
                        {m.voyage && (
                          <div className="text-xs text-[var(--color-text-muted)]">Viaje {m.voyage}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </Td>
                  <Td>{m.eta ?? "—"}</Td>
                  <Td>
                    <Badge color={badgeColor}>{stageLabel}</Badge>
                  </Td>
                  <Td>
                    {m.tracking_enabled ? (
                      <span
                        title={`Proveedor: ${m.tracking_provider ?? "manual"}`}
                        className="inline-flex h-2 w-2 rounded-full bg-[var(--color-success)]"
                        aria-label="Tracking activo"
                      />
                    ) : (
                      <span
                        className="inline-flex h-2 w-2 rounded-full bg-[var(--color-border)]"
                        aria-label="Tracking inactivo"
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        </Card>
      )}
    </div>
  );
}
