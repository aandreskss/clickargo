import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge, Card, EmptyState, Table, Td, Tr } from "@/components/ui";
import { STAGE_LABELS, STAGE_BADGE_COLORS } from "@/lib/field-packs";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";

export default async function PortalFichaEmbarque({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) notFound();

  // RLS garantiza que el cliente solo puede ver su propio embarque
  const [{ data: ship }, { data: events }, { data: docs }] = await Promise.all([
    supabase
      .from("shipments")
      .select("id, number, stage_key, mode, origin_port_id, destination_port_id, eta, etd, cargo_description")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("shipment_events")
      .select("id, kind, note, occurred_at, visible_to_customer")
      .eq("shipment_id", id)
      .eq("visible_to_customer", true)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("shipment_documents")
      .select("id, filename, kind, created_at, storage_path")
      .eq("shipment_id", id)
      .eq("visible_to_customer", true)
      .eq("scan_status", "clean")
      .order("created_at", { ascending: false }),
  ]);

  if (!ship) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            Embarque {ship.number}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {ship.origin_port_id} → {ship.destination_port_id}
          </p>
        </div>
        <Link
          href="/portal"
          className="text-sm font-medium text-[var(--color-text-link)] hover:underline"
        >
          ← Volver
        </Link>
      </div>

      {/* Resumen */}
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Etapa</p>
            <Badge color={STAGE_BADGE_COLORS[ship.stage_key] ?? "default"}>
              {STAGE_LABELS[ship.stage_key] ?? ship.stage_key}
            </Badge>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase">ETA</p>
            <p className="mt-1 text-sm font-medium">{ship.eta ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase">ETD</p>
            <p className="mt-1 text-sm font-medium">{ship.etd ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Modo</p>
            <p className="mt-1 text-sm capitalize">{ship.mode?.replace("_", " ")}</p>
          </div>
          {ship.cargo_description && (
            <div className="col-span-2">
              <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase">Descripción</p>
              <p className="mt-1 text-sm">{ship.cargo_description}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Seguimiento */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Seguimiento</h2>
        {(events ?? []).length === 0 ? (
          <Card>
            <EmptyState title="Sin actualizaciones" description="Aquí aparecerán las actualizaciones de tu embarque." />
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-[var(--color-border)]">
              {(events ?? []).map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{STAGE_LABELS[e.kind] ?? e.kind}</p>
                      {e.note && <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{e.note}</p>}
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

      {/* Documentos */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Documentos</h2>
        {(docs ?? []).length === 0 ? (
          <Card>
            <EmptyState title="Sin documentos" description="Cuando tu agente suba documentos de este embarque aparecerán aquí." />
          </Card>
        ) : (
          <Card>
            <Table cols={["Nombre", "Tipo", "Fecha"]}>
              {(docs ?? []).map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <a
                      href={`/archivos/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-[var(--color-text-link)] hover:underline"
                    >
                      {d.filename}
                    </a>
                  </Td>
                  <Td className="text-sm capitalize text-[var(--color-text-muted)]">{d.kind}</Td>
                  <Td className="text-sm text-[var(--color-text-muted)]">
                    {new Date(d.created_at).toLocaleDateString("es-DO", {
                      year: "numeric", month: "short", day: "numeric",
                    })}
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
