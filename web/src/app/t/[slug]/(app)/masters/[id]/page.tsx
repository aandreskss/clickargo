import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Badge, Button, Card, EmptyState, Field, Notice, Table, Tabs, Td, Tr,
} from "@/components/ui";
import {
  STAGE_LABELS, STAGE_BADGE_COLORS, SHIPMENT_MODES, type BadgeColor,
} from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import {
  linkShipment, unlinkShipment, addManualTrackingEvent, acceptSuggestion, dismissSuggestion,
} from "@/app/actions/masters";

export default async function FichaMaster({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; tab?: string }>;
}) {
  const { slug, id } = await params;
  const { ok, error, tab = "resumen" } = await searchParams;
  const okMsg    = decode(ok);
  const errorMsg = decode(error);

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const [
    { data: master },
    { data: houses },
    { data: trackingEvents },
    { data: masterContainers },
    { data: containerTypes },
  ] = await Promise.all([
    supabase.from("masters")
      .select(`id, number, master_number, mode, stage_key,
               carrier_account_id, vessel_or_flight, voyage,
               origin_port_id, destination_port_id,
               etd, eta, atd, ata,
               tracking_enabled, tracking_provider, tracking_ref, last_tracked_at,
               pending_suggestion_stage, pending_suggestion_at,
               notes, created_at, updated_at`)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("shipments")
      .select("id, number, stage_key, account_id, mode, direction")
      .eq("master_id", id)
      .order("created_at"),
    supabase.from("tracking_events")
      .select("id, provider, event_code, event_label, location, occurred_at, received_at")
      .eq("master_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase.from("master_containers")
      .select("id, container_number, container_type_id, seal_number, weight_kg, notes")
      .eq("master_id", id)
      .order("created_at"),
    supabase.from("container_types").select("code, name"),
  ]);

  if (!master) notFound();

  // Load related accounts and ports
  const accountIds = [master.carrier_account_id, ...(houses ?? []).map((h) => h.account_id)]
    .filter(Boolean) as string[];
  const portCodes = [master.origin_port_id, master.destination_port_id].filter(Boolean) as string[];

  const [{ data: relatedAccounts }, { data: ports }, { data: freeShipments }] = await Promise.all([
    accountIds.length > 0
      ? supabase.from("accounts").select("id, name").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    portCodes.length > 0
      ? supabase.from("ports").select("code, name, country_code").in("code", portCodes)
      : Promise.resolve({ data: [] as { code: string; name: string; country_code: string }[] }),
    // Shipments available to link (same mode, no master, not terminal)
    supabase.from("shipments")
      .select("id, number")
      .is("master_id", null)
      .eq("mode", master.mode)
      .not("stage_key", "in", "(completed,cancelled)")
      .order("number")
      .limit(100),
  ]);

  const accountName = (aid: string | null | undefined) =>
    relatedAccounts?.find((a) => a.id === aid)?.name ?? "—";
  const portName = (code: string | null | undefined) => {
    const p = ports?.find((p) => p.code === code);
    return p ? `${p.name} (${p.country_code})` : (code ?? "—");
  };
  const ctLabel = (code: string | null | undefined) =>
    containerTypes?.find((c) => c.code === code)?.name ?? code ?? "—";

  const stageKey   = master.stage_key ?? "draft";
  const badgeColor = (STAGE_BADGE_COLORS[stageKey] ?? "default") as BadgeColor;
  const stageLabel = STAGE_LABELS[stageKey] ?? stageKey;
  const modeLabel  = SHIPMENT_MODES.find((m) => m.value === master.mode)?.label ?? master.mode ?? "—";

  const baseUrl = `/masters/${id}`;
  const TABS = [
    { value: "resumen",      label: "Resumen",      href: `${baseUrl}?tab=resumen`      },
    { value: "houses",       label: "Houses",        href: `${baseUrl}?tab=houses`       },
    { value: "contenedores", label: "Contenedores",  href: `${baseUrl}?tab=contenedores` },
    { value: "tracking",     label: "Tracking",      href: `${baseUrl}?tab=tracking`     },
  ];
  const activeTab = ["resumen", "houses", "contenedores", "tracking"].includes(tab) ? tab : "resumen";

  const freeShipmentOptions = [
    { value: "", label: "— Selecciona un embarque —" },
    ...(freeShipments ?? []).map((s) => ({ value: s.id, label: s.number })),
  ];

  const hasSuggestion = !!master.pending_suggestion_stage;

  const providerLabel: Record<string, string> = {
    terminal49: "Terminal49",
    manual:     "Manual",
  };

  const eventCodeLabel: Record<string, string> = {
    "vessel.departure":        "Salida de buque",
    "vessel.arrival":          "Llegada de buque",
    "container.pickup":        "Recogida de contenedor",
    "container.discharge":     "Descarga de contenedor",
    "container.delivery":      "Entrega de contenedor",
    "container.customs_release": "Liberación aduanera",
    "container.customs_hold":  "Retención aduanera",
  };

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{master.number}</h1>
            <Badge color={badgeColor}>{stageLabel}</Badge>
            {master.tracking_enabled && (
              <Badge color="success">Tracking activo</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {master.master_number} · {modeLabel}
            {master.vessel_or_flight ? ` · ${master.vessel_or_flight}` : ""}
            {master.eta ? ` · ETA ${master.eta}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/masters">
            <Button variant="ghost" type="button">← Volver</Button>
          </Link>
          <Link href={`/masters/${id}/editar`}>
            <Button variant="ghost" type="button">Editar</Button>
          </Link>
        </div>
      </div>

      <Notice error={errorMsg} info={okMsg} />

      {/* Sugerencia de tracking pendiente */}
      {hasSuggestion && (
        <div className="rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-bg,#fffbeb)] p-4">
          <p className="mb-3 text-sm font-semibold text-[var(--color-warning)]">
            Sugerencia del tracking
          </p>
          <p className="mb-4 text-sm text-[var(--color-text)]">
            Se detectó el evento{" "}
            <strong>{eventCodeLabel[master.pending_suggestion_stage!] ?? master.pending_suggestion_stage}</strong>.
            ¿Avanzar los embarques activos del master a esta etapa?
          </p>
          <div className="flex gap-3">
            <form action={acceptSuggestion}>
              <input type="hidden" name="master_id" value={id} />
              <input type="hidden" name="back" value={`/masters/${id}?tab=tracking`} />
              <Button type="submit">
                Aceptar — avanzar a {STAGE_LABELS[master.pending_suggestion_stage!] ?? master.pending_suggestion_stage}
              </Button>
            </form>
            <form action={dismissSuggestion}>
              <input type="hidden" name="master_id" value={id} />
              <input type="hidden" name="back" value={`/masters/${id}?tab=tracking`} />
              <Button type="submit" variant="ghost">Descartar</Button>
            </form>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs tabs={TABS} active={activeTab} />

      {/* ── Tab: Resumen ── */}
      {activeTab === "resumen" && (
        <Card>
          <dl className="grid gap-y-4 gap-x-6 sm:grid-cols-2 text-sm">
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">MBL / MAWB</dt>
              <dd className="font-mono text-[var(--color-text)]">{master.master_number}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Modo</dt>
              <dd className="text-[var(--color-text)]">{modeLabel}</dd>
            </div>
            {master.carrier_account_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Naviera / Aerolínea</dt>
                <dd className="text-[var(--color-text)]">{accountName(master.carrier_account_id)}</dd>
              </div>
            )}
            {master.vessel_or_flight && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Nave / Vuelo</dt>
                <dd className="text-[var(--color-text)]">
                  {master.vessel_or_flight}
                  {master.voyage ? ` — Viaje ${master.voyage}` : ""}
                </dd>
              </div>
            )}
            {master.origin_port_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Puerto de origen</dt>
                <dd className="text-[var(--color-text)]">{portName(master.origin_port_id)}</dd>
              </div>
            )}
            {master.destination_port_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Puerto de destino</dt>
                <dd className="text-[var(--color-text)]">{portName(master.destination_port_id)}</dd>
              </div>
            )}
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">ETD / ATD</dt>
              <dd className="text-[var(--color-text)]">{master.etd ?? "—"} / {master.atd ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">ETA / ATA</dt>
              <dd className="text-[var(--color-text)]">{master.eta ?? "—"} / {master.ata ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Houses vinculados</dt>
              <dd className="text-[var(--color-text)]">{(houses ?? []).length}</dd>
            </div>
            {master.tracking_enabled && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Proveedor de tracking</dt>
                <dd className="text-[var(--color-text)]">
                  {providerLabel[master.tracking_provider ?? "manual"] ?? master.tracking_provider ?? "—"}
                  {master.last_tracked_at && (
                    <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                      Última sync: {new Date(master.last_tracked_at).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  )}
                </dd>
              </div>
            )}
            {master.notes && (
              <div className="sm:col-span-2">
                <dt className="font-medium text-[var(--color-text-muted)]">Notas</dt>
                <dd className="whitespace-pre-wrap text-[var(--color-text)]">{master.notes}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {/* ── Tab: Houses ── */}
      {activeTab === "houses" && (
        <div className="space-y-4">
          {/* Vincular embarque */}
          {freeShipmentOptions.length > 1 && (
            <Card>
              <h2 className="mb-3 font-semibold text-[var(--color-text)]">Vincular embarque</h2>
              <form action={linkShipment} className="flex flex-wrap gap-3">
                <input type="hidden" name="master_id" value={id} />
                <select
                  name="shipment_id"
                  required
                  className="flex-1 min-w-48 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
                >
                  {freeShipmentOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <Button type="submit">Vincular</Button>
              </form>
            </Card>
          )}

          {/* Lista de houses */}
          {(houses ?? []).length === 0 ? (
            <Card>
              <EmptyState
                title="Sin embarques vinculados"
                description="Vincula embarques (houses) a este master para agruparlos."
              />
            </Card>
          ) : (
            <Card className="p-0">
              <div className="p-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">
                  Embarques vinculados ({houses!.length})
                </h2>
              </div>
              <Table cols={["Número", "Cliente", "Etapa", ""]}>
                {(houses ?? []).map((h) => {
                  const hBadge = (STAGE_BADGE_COLORS[h.stage_key] ?? "default") as BadgeColor;
                  return (
                    <Tr key={h.id}>
                      <Td>
                        <Link
                          href={`/embarques/${h.id}`}
                          className="font-semibold text-[var(--color-primary)] hover:underline"
                        >
                          {h.number}
                        </Link>
                      </Td>
                      <Td>{accountName(h.account_id)}</Td>
                      <Td>
                        <Badge color={hBadge}>
                          {STAGE_LABELS[h.stage_key] ?? h.stage_key}
                        </Badge>
                      </Td>
                      <Td>
                        <form action={unlinkShipment}>
                          <input type="hidden" name="master_id" value={id} />
                          <input type="hidden" name="shipment_id" value={h.id} />
                          <Button type="submit" variant="ghost">Desvincular</Button>
                        </form>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ── Tab: Contenedores ── */}
      {activeTab === "contenedores" && (
        <div className="space-y-4">
          {(masterContainers ?? []).length === 0 ? (
            <Card>
              <EmptyState
                title="Sin contenedores del master"
                description="Agrega los contenedores del master BL aquí."
              />
            </Card>
          ) : (
            <Card className="p-0">
              <div className="p-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">
                  Contenedores ({masterContainers!.length})
                </h2>
              </div>
              <Table cols={["Contenedor", "Tipo", "Precinto", "Peso (kg)", "Notas"]}>
                {(masterContainers ?? []).map((c) => (
                  <Tr key={c.id}>
                    <Td><span className="font-mono">{c.container_number ?? "—"}</span></Td>
                    <Td>{ctLabel(c.container_type_id)}</Td>
                    <Td className="font-mono">{c.seal_number ?? "—"}</Td>
                    <Td className="text-right tabular-nums">
                      {c.weight_kg != null ? Number(c.weight_kg).toLocaleString("es-DO") : "—"}
                    </Td>
                    <Td>{c.notes ?? "—"}</Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ── Tab: Tracking ── */}
      {activeTab === "tracking" && (
        <div className="space-y-4">
          {/* Estado del proveedor */}
          <Card>
            <h2 className="mb-3 font-semibold text-[var(--color-text)]">Estado del tracking</h2>
            <dl className="grid gap-3 sm:grid-cols-3 text-sm">
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Proveedor</dt>
                <dd className="text-[var(--color-text)]">
                  {providerLabel[master.tracking_provider ?? "manual"] ?? "Manual"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Referencia</dt>
                <dd className="font-mono text-[var(--color-text)]">{master.tracking_ref ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Última sync</dt>
                <dd className="text-[var(--color-text)]">
                  {master.last_tracked_at
                    ? new Date(master.last_tracked_at).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" })
                    : "Nunca"}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Agregar evento manual */}
          {(!master.tracking_provider || master.tracking_provider === "manual") && (
            <Card>
              <h2 className="mb-3 font-semibold text-[var(--color-text)]">Registrar evento manual</h2>
              <form action={addManualTrackingEvent} className="space-y-4">
                <input type="hidden" name="master_id" value={id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field name="event_code" label="Código de evento" placeholder="Ej. vessel.departure" />
                  <Field name="event_label" label="Descripción del evento" placeholder="Ej. Buque salió del puerto" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    name="occurred_at"
                    label="Fecha y hora del evento"
                    type="datetime-local"
                    defaultValue={new Date().toISOString().slice(0, 16)}
                  />
                  <Field name="location" label="Ubicación" placeholder="Ej. Puerto de Shanghai" required={false} />
                </div>
                <Button type="submit">Registrar evento</Button>
              </form>
            </Card>
          )}

          {/* Timeline de eventos */}
          {(trackingEvents ?? []).length === 0 ? (
            <Card>
              <EmptyState
                title="Sin eventos de tracking"
                description={
                  master.tracking_enabled
                    ? "El proveedor aún no ha enviado eventos. El cron diario los cargará automáticamente."
                    : "Habilita el tracking o registra eventos manualmente."
                }
              />
            </Card>
          ) : (
            <Card className="p-0">
              <div className="p-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">
                  Historial de eventos ({(trackingEvents ?? []).length})
                </h2>
              </div>
              <ul className="divide-y divide-[var(--color-border)]">
                {(trackingEvents ?? []).map((ev) => (
                  <li key={ev.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                            {providerLabel[ev.provider] ?? ev.provider}
                          </span>
                          <span className="font-mono text-xs text-[var(--color-text-muted)]">
                            {ev.event_code}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
                          {eventCodeLabel[ev.event_code] ?? ev.event_label}
                        </p>
                        {ev.location && (
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{ev.location}</p>
                        )}
                      </div>
                      <time className="shrink-0 text-xs text-[var(--color-text-muted)]">
                        {new Date(ev.occurred_at).toLocaleString("es-DO", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
