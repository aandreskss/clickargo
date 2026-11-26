import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Badge, Button, Card, EmptyState, Field, Notice, Table, Tabs, Td, Tr,
} from "@/components/ui";
import {
  STAGE_LABELS, STAGE_BADGE_COLORS, SHIPMENT_MODES, SHIPMENT_DIRECTIONS,
  SHIPMENT_FIELD_LABELS, type BadgeColor,
} from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { nextStage, canAdvance, TERMINAL_STAGES, type StageKey } from "@/lib/stage-rules";
import { validateISO6346 } from "@/lib/container-validation";
import { advanceStage, cancelShipment } from "@/app/actions/shipments";
import { assignMasterToShipment } from "@/app/actions/masters";
import { createCharge, deleteCharge, importFromQuote } from "@/app/actions/charges";
import { createPreInvoice } from "@/app/actions/pre-invoices";
import { uploadShipmentDocument, deleteShipmentDocument, sendArrivalNoticePdf } from "@/app/actions/documents";
import { SendEmailTrigger } from "@/components/send-email-trigger";
import { FileDropZone } from "@/components/file-drop-zone";
import CargoForm from "./cargo-form";

export default async function FichaEmbarque({
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

  const { data: { user } } = await supabase.auth.getUser();

  const [
    { data: ship },
    { data: containers },
    { data: events },
    { data: containerTypes },
  ] = await Promise.all([
    supabase.from("shipments")
      .select(`id, number, stage_key, mode, direction,
               origin_port_id, destination_port_id, incoterm,
               carrier_account_id, booking_number, bl_number,
               vessel_or_flight, voyage, etd, eta, atd, ata,
               cargo_description, packages, weight_kg, volume_cbm,
               customer_reference, notes, internal_notes,
               account_id, shipper_account_id, consignee_account_id,
               notify_party_account_id, quote_id, master_id, created_at, updated_at`)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("shipment_containers")
      .select("id, container_number, container_type_id, seal_number, weight_kg, notes")
      .eq("shipment_id", id)
      .order("created_at"),
    supabase.from("shipment_events")
      .select("id, kind, from_stage, to_stage, message, created_at")
      .eq("shipment_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("container_types").select("code, name"),
  ]);

  if (!ship) notFound();

  // Load master data and tracking events if shipment has a master
  const [{ data: master }, { data: masterTrackingEvents }, { data: availableMasters }] =
    await Promise.all([
      ship.master_id
        ? supabase.from("masters").select("id, number, master_number, mode").eq("id", ship.master_id).maybeSingle()
        : Promise.resolve({ data: null }),
      ship.master_id
        ? supabase.from("tracking_events")
            .select("id, event_code, event_label, location, occurred_at, provider")
            .eq("master_id", ship.master_id)
            .order("occurred_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] as Array<{ id: number; event_code: string; event_label: string; location: string | null; occurred_at: string; provider: string }> }),
      !ship.master_id
        ? supabase.from("masters")
            .select("id, number, master_number")
            .eq("mode", ship.mode)
            .not("stage_key", "in", "(completed,cancelled)")
            .order("number")
            .limit(50)
        : Promise.resolve({ data: [] as Array<{ id: string; number: string; master_number: string }> }),
    ]);

  const stageKey = ship.stage_key as StageKey;
  const isTerminal = TERMINAL_STAGES.has(stageKey);

  // Cargar cuentas y puertos referenciados
  const accountIds = [
    ship.account_id,
    ship.carrier_account_id,
    ship.shipper_account_id,
    ship.consignee_account_id,
    ship.notify_party_account_id,
  ].filter(Boolean) as string[];

  const portCodes = [ship.origin_port_id, ship.destination_port_id].filter(Boolean) as string[];

  // Verificar can_see_costs para el tab de Cargos
  const { data: membership } = await supabase
    .from("memberships")
    .select("can_see_costs, role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user!.id)
    .maybeSingle();
  const canSeeCosts = membership?.can_see_costs === true;

  const [{ data: relatedAccounts }, { data: ports }, { data: shipmentDocs }] = await Promise.all([
    accountIds.length > 0
      ? supabase.from("accounts").select("id, name, email").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string; email: string | null }[] }),
    portCodes.length > 0
      ? supabase.from("ports").select("code, name, country_code").in("code", portCodes)
      : Promise.resolve({ data: [] as { code: string; name: string; country_code: string }[] }),
    supabase.from("shipment_documents")
      .select("id, title, kind, mime_type, size_bytes, visible_to_customer, created_at, uploaded_by")
      .eq("shipment_id", id)
      .order("created_at"),
  ]);

  // Datos del tab Cargos (solo cuando corresponde — siempre cargamos, es liviano)
  const [
    { data: charges },
    { data: chargeCosts },
    { data: chargeTypes },
    { data: allAccounts },
    { data: marginRows },
  ] = await Promise.all([
    supabase
      .from("shipment_charges")
      .select("id, charge_type_id, description, quantity, unit, unit_price, currency, tax_rate, bill_to_account_id, pre_invoice_id, sort_order")
      .eq("shipment_id", id)
      .order("sort_order"),
    canSeeCosts
      ? supabase
          .from("shipment_charge_costs")
          .select("shipment_charge_id, vendor_account_id, unit_cost, currency")
          .in("shipment_charge_id", (await supabase.from("shipment_charges").select("id").eq("shipment_id", id)).data?.map((c) => c.id) ?? [])
      : Promise.resolve({ data: null }),
    supabase.from("charge_types").select("code, name, default_unit"),
    supabase.from("accounts").select("id, name").eq("tenant_id", tenant.id).limit(200),
    canSeeCosts
      ? supabase.from("shipment_margin").select("currency, venta, costo, margen, margen_pct").eq("shipment_id", id)
      : Promise.resolve({ data: null }),
  ]);

  const accountName = (aid: string | null | undefined) =>
    relatedAccounts?.find((a) => a.id === aid)?.name ?? "—";
  const portName = (code: string | null | undefined) => {
    const p = ports?.find((p) => p.code === code);
    return p ? `${p.name} (${p.country_code})` : (code ?? "—");
  };
  const ctLabel = (code: string | null | undefined) =>
    containerTypes?.find((c) => c.code === code)?.name ?? code ?? "—";

  // Siguiente etapa y validación de avance (server-side)
  const nextKey = isTerminal ? null : nextStage(stageKey);
  const advanceCheck = nextKey
    ? canAdvance(
        {
          account_id:          ship.account_id,
          mode:                ship.mode,
          direction:           ship.direction,
          origin_port_id:      ship.origin_port_id,
          destination_port_id: ship.destination_port_id,
          carrier_account_id:  ship.carrier_account_id,
          booking_number:      ship.booking_number,
          etd:                 ship.etd,
          eta:                 ship.eta,
          ata:                 ship.ata,
        },
        nextKey
      )
    : null;

  const missingLabel =
    advanceCheck && !advanceCheck.ok
      ? advanceCheck.missing.map((f) => SHIPMENT_FIELD_LABELS[f] ?? f).join(", ")
      : "";

  const baseUrl = `/embarques/${id}`;
  const TABS = [
    { value: "resumen",    label: "Resumen",             href: `${baseUrl}?tab=resumen`    },
    { value: "carga",      label: "Carga y contenedores", href: `${baseUrl}?tab=carga`      },
    { value: "cargos",     label: "Cargos",              href: `${baseUrl}?tab=cargos`     },
    { value: "documentos", label: "Documentos",          href: `${baseUrl}?tab=documentos` },
    { value: "historial",  label: "Historial",           href: `${baseUrl}?tab=historial`  },
    { value: "tracking",   label: "Tracking",            href: `${baseUrl}?tab=tracking`   },
  ];
  const activeTab = ["resumen","carga","cargos","documentos","historial","tracking"].includes(tab) ? tab : "resumen";

  // Helpers para tab Cargos
  const fmtMoney = (n: number, cur = "USD") =>
    new Intl.NumberFormat("es-DO", { style: "currency", currency: cur }).format(n);
  const ctName = (code: string) =>
    chargeTypes?.find((c) => c.code === code)?.name ?? code;
  const costOf = (chargeId: string) =>
    chargeCosts?.find((c) => c.shipment_charge_id === chargeId);
  const unitLabel: Record<string, string> = {
    container: "Contenedor", kg: "Kg", cbm: "CBM", unit: "Unidad", flat: "Global",
  };

  const eventCodeLabel: Record<string, string> = {
    "vessel.departure":          "Salida de buque",
    "vessel.arrival":            "Llegada de buque",
    "container.pickup":          "Recogida de contenedor",
    "container.discharge":       "Descarga de contenedor",
    "container.delivery":        "Entrega de contenedor",
    "container.customs_release": "Liberación aduanera",
    "container.customs_hold":    "Retención aduanera",
  };

  const badgeColor = (STAGE_BADGE_COLORS[stageKey] ?? "default") as BadgeColor;
  const stageLabel = STAGE_LABELS[stageKey] ?? stageKey;
  const modeLabel  = SHIPMENT_MODES.find((m) => m.value === ship.mode)?.label ?? ship.mode ?? "—";
  const dirLabel   = SHIPMENT_DIRECTIONS.find((d) => d.value === ship.direction)?.label ?? ship.direction ?? "—";

  const eventKindLabel: Record<string, string> = {
    stage_changed: "Etapa",
    eta_changed:   "ETA cambiada",
    note:          "Nota",
    document:      "Documento",
    tracking:      "Tracking",
    system:        "Sistema",
  };

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{ship.number}</h1>
            <Badge color={badgeColor}>{stageLabel}</Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {accountName(ship.account_id)} ·{" "}
            {portName(ship.origin_port_id)} → {portName(ship.destination_port_id)} ·{" "}
            {modeLabel} — {dirLabel}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/embarques">
            <Button variant="ghost" type="button">← Volver</Button>
          </Link>
          {!isTerminal && (
            <Link href={`/embarques/${id}/editar`}>
              <Button variant="ghost" type="button">Editar</Button>
            </Link>
          )}
          {nextKey && (
            <form action={advanceStage}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="to_stage" value={nextKey} />
              {advanceCheck?.ok ? (
                <Button type="submit">Avanzar a {STAGE_LABELS[nextKey]}</Button>
              ) : (
                <span title={`Faltan: ${missingLabel}`} className="inline-block">
                  <Button type="button" disabled>Avanzar a {STAGE_LABELS[nextKey]}</Button>
                </span>
              )}
            </form>
          )}
        </div>
      </div>

      <Notice error={errorMsg} info={okMsg} />

      {/* Tabs de navegación */}
      <Tabs tabs={TABS} active={activeTab} />

      {/* ── Tab: Resumen ── */}
      {activeTab === "resumen" && (
        <Card>
          <dl className="grid gap-y-4 gap-x-6 sm:grid-cols-2 text-sm">
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Cliente</dt>
              <dd className="text-[var(--color-text)]">{accountName(ship.account_id)}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Modo</dt>
              <dd className="text-[var(--color-text)]">{modeLabel} — {dirLabel}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Puerto de origen</dt>
              <dd className="text-[var(--color-text)]">{portName(ship.origin_port_id)}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">Puerto de destino</dt>
              <dd className="text-[var(--color-text)]">{portName(ship.destination_port_id)}</dd>
            </div>
            {ship.incoterm && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Incoterm</dt>
                <dd className="text-[var(--color-text)]">{ship.incoterm}</dd>
              </div>
            )}
            {ship.carrier_account_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Naviera / Aerolínea</dt>
                <dd className="text-[var(--color-text)]">{accountName(ship.carrier_account_id)}</dd>
              </div>
            )}
            {ship.booking_number && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Booking</dt>
                <dd className="font-mono text-[var(--color-text)]">{ship.booking_number}</dd>
              </div>
            )}
            {ship.bl_number && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">BL</dt>
                <dd className="font-mono text-[var(--color-text)]">{ship.bl_number}</dd>
              </div>
            )}
            {ship.vessel_or_flight && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Nave / Vuelo</dt>
                <dd className="text-[var(--color-text)]">
                  {ship.vessel_or_flight}
                  {ship.voyage ? ` — Viaje ${ship.voyage}` : ""}
                </dd>
              </div>
            )}
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">ETD / ATD</dt>
              <dd className="text-[var(--color-text)]">{ship.etd ?? "—"} / {ship.atd ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--color-text-muted)]">ETA / ATA</dt>
              <dd className="text-[var(--color-text)]">{ship.eta ?? "—"} / {ship.ata ?? "—"}</dd>
            </div>
            {ship.customer_reference && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Ref. cliente</dt>
                <dd className="text-[var(--color-text)]">{ship.customer_reference}</dd>
              </div>
            )}
            {ship.shipper_account_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Embarcador</dt>
                <dd className="text-[var(--color-text)]">{accountName(ship.shipper_account_id)}</dd>
              </div>
            )}
            {ship.consignee_account_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Consignatario</dt>
                <dd className="text-[var(--color-text)]">{accountName(ship.consignee_account_id)}</dd>
              </div>
            )}
            {ship.notify_party_account_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Notify party</dt>
                <dd className="text-[var(--color-text)]">{accountName(ship.notify_party_account_id)}</dd>
              </div>
            )}
            {ship.quote_id && (
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Cotización de origen</dt>
                <dd>
                  <Link
                    href={`/cotizaciones/${ship.quote_id}`}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    Ver cotización
                  </Link>
                </dd>
              </div>
            )}
            {ship.notes && (
              <div className="sm:col-span-2">
                <dt className="font-medium text-[var(--color-text-muted)]">Notas</dt>
                <dd className="whitespace-pre-wrap text-[var(--color-text)]">{ship.notes}</dd>
              </div>
            )}
            {ship.internal_notes && (
              <div className="sm:col-span-2">
                <dt className="font-medium text-[var(--color-text-muted)]">Notas internas</dt>
                <dd className="whitespace-pre-wrap text-xs text-[var(--color-text-muted)]">
                  {ship.internal_notes}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-4 border-t border-[var(--color-border)] pt-4 flex flex-wrap gap-2">
            <a href={`/api/documentos/embarque-aviso/${id}`} download>
              <Button variant="ghost" type="button">Aviso de llegada PDF</Button>
            </a>
            <SendEmailTrigger
              documentType="arrival_notice"
              documentId={id}
              documentNumber={ship.number}
              defaultEmail={relatedAccounts?.find((a) => a.id === (ship.consignee_account_id ?? ship.account_id))?.email ?? ""}
              pdfHref={`/api/documentos/embarque-aviso/${id}`}
              action={sendArrivalNoticePdf}
            />
          </div>
        </Card>
      )}

      {/* ── Tab: Carga y contenedores ── */}
      {activeTab === "carga" && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-semibold text-[var(--color-text)]">Descripción de carga</h2>
            <dl className="grid gap-4 sm:grid-cols-3 text-sm">
              {ship.cargo_description && (
                <div className="sm:col-span-3">
                  <dt className="font-medium text-[var(--color-text-muted)]">Descripción</dt>
                  <dd className="whitespace-pre-wrap text-[var(--color-text)]">{ship.cargo_description}</dd>
                </div>
              )}
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Bultos</dt>
                <dd className="text-[var(--color-text)]">
                  {ship.packages != null ? ship.packages.toLocaleString("es-DO") : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Peso (kg)</dt>
                <dd className="text-[var(--color-text)]">
                  {ship.weight_kg != null ? Number(ship.weight_kg).toLocaleString("es-DO") : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-text-muted)]">Volumen (m³)</dt>
                <dd className="text-[var(--color-text)]">
                  {ship.volume_cbm != null ? Number(ship.volume_cbm).toLocaleString("es-DO") : "—"}
                </dd>
              </div>
            </dl>
          </Card>

          {ship.mode === "ocean" && (
            <Card className="p-0">
              <div className="p-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">Contenedores</h2>
              </div>
              {(containers ?? []).length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="Sin contenedores"
                    description="Agrega contenedores al editar el embarque."
                  />
                </div>
              ) : (
                <Table cols={["Contenedor", "Tipo", "Precinto", "Peso (kg)", "Notas"]}>
                  {(containers ?? []).map((c) => {
                    const isoCheck = c.container_number
                      ? validateISO6346(c.container_number)
                      : null;
                    return (
                      <Tr key={c.id}>
                        <Td>
                          <span className="font-mono">{c.container_number ?? "—"}</span>
                          {isoCheck && !isoCheck.valid && (
                            <span
                              className="ml-2 text-xs text-[var(--color-warning)]"
                              title={isoCheck.reason}
                            >
                              ⚠ Formato inválido
                            </span>
                          )}
                        </Td>
                        <Td>{ctLabel(c.container_type_id)}</Td>
                        <Td className="font-mono">{c.seal_number ?? "—"}</Td>
                        <Td className="text-right tabular-nums">
                          {c.weight_kg != null ? Number(c.weight_kg).toLocaleString("es-DO") : "—"}
                        </Td>
                        <Td>{c.notes ?? "—"}</Td>
                      </Tr>
                    );
                  })}
                </Table>
              )}
            </Card>
          )}

          {ship.mode === "air" && (
            <Card>
              <EmptyState
                title="Embarque aéreo"
                description="Los embarques aéreos no tienen contenedores."
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Tab: Historial ── */}
      {activeTab === "historial" && (
        <Card className="p-0">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h2 className="font-semibold text-[var(--color-text)]">Historial de eventos</h2>
          </div>
          {(events ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Sin eventos"
                description="Aquí aparecerán los cambios de etapa y notas del embarque."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {(events ?? []).map((ev) => (
                <li key={ev.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                          {eventKindLabel[ev.kind] ?? ev.kind}
                        </span>
                        {ev.kind === "stage_changed" && ev.to_stage && (
                          <span className="flex items-center gap-1.5">
                            {ev.from_stage && (
                              <>
                                <Badge
                                  color={(STAGE_BADGE_COLORS[ev.from_stage] ?? "default") as BadgeColor}
                                >
                                  {STAGE_LABELS[ev.from_stage] ?? ev.from_stage}
                                </Badge>
                                <span className="text-[var(--color-text-muted)]">→</span>
                              </>
                            )}
                            <Badge
                              color={(STAGE_BADGE_COLORS[ev.to_stage] ?? "default") as BadgeColor}
                            >
                              {STAGE_LABELS[ev.to_stage] ?? ev.to_stage}
                            </Badge>
                          </span>
                        )}
                      </div>
                      {ev.message && (
                        <p className="mt-1 text-sm text-[var(--color-text)]">{ev.message}</p>
                      )}
                    </div>
                    <time className="shrink-0 text-xs text-[var(--color-text-muted)]">
                      {new Date(ev.created_at).toLocaleString("es-DO", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Tab: Tracking ── */}
      {activeTab === "tracking" && (
        <div className="space-y-4">
          {ship.master_id && master ? (
            <>
              {/* Master vinculado */}
              <Card>
                <h2 className="mb-3 font-semibold text-[var(--color-text)]">Master vinculado</h2>
                <p className="text-sm text-[var(--color-text)]">
                  Este embarque forma parte del master{" "}
                  <Link
                    href={`/masters/${master.id}`}
                    className="font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    {master.number}
                  </Link>
                  {" "}({master.master_number}).
                </p>
              </Card>

              {/* Timeline de tracking del master */}
              {(masterTrackingEvents ?? []).length === 0 ? (
                <Card>
                  <EmptyState
                    title="Sin eventos de tracking"
                    description="Aún no hay eventos del proveedor de tracking para este master."
                  />
                </Card>
              ) : (
                <Card className="p-0">
                  <div className="p-4 border-b border-[var(--color-border)]">
                    <h2 className="font-semibold text-[var(--color-text)]">
                      Eventos del master ({(masterTrackingEvents ?? []).length})
                    </h2>
                  </div>
                  <ul className="divide-y divide-[var(--color-border)]">
                    {(masterTrackingEvents ?? []).map((ev) => (
                      <li key={ev.id} className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[var(--color-text)]">
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
            </>
          ) : (
            /* Sin master — mostrar opción de asignar */
            <Card>
              <EmptyState
                title="Sin master asignado"
                description="Asigna este embarque a un master BL para ver el tracking automático."
              />
              {!isTerminal && (availableMasters ?? []).length > 0 && (
                <form action={assignMasterToShipment} className="mt-4 flex flex-wrap gap-3">
                  <input type="hidden" name="shipment_id" value={id} />
                  <select
                    name="master_id"
                    required
                    className="flex-1 min-w-48 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
                  >
                    <option value="">— Selecciona un master —</option>
                    {(availableMasters ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.number} — {m.master_number}
                      </option>
                    ))}
                  </select>
                  <Button type="submit">Asignar master</Button>
                </form>
              )}
              {!isTerminal && (availableMasters ?? []).length === 0 && (
                <div className="mt-4">
                  <Link href="/masters/nuevo">
                    <Button variant="secondary" type="button">Crear master</Button>
                  </Link>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── Tab: Cargos ── */}
      {activeTab === "cargos" && (
        <div className="space-y-4">
          {/* Acciones rápidas */}
          <div className="flex flex-wrap gap-2">
            {ship.quote_id && !isTerminal && (
              <form action={importFromQuote}>
                <input type="hidden" name="shipment_id" value={id} />
                <Button variant="secondary" type="submit">Cargar desde cotización</Button>
              </form>
            )}
            {(charges ?? []).filter((c) => !c.pre_invoice_id).length > 0 && (
              <form action={createPreInvoice}>
                <input
                  type="hidden"
                  name="charge_ids"
                  value={JSON.stringify(
                    (charges ?? []).filter((c) => !c.pre_invoice_id).map((c) => c.id)
                  )}
                />
                <Button variant="primary" type="submit">Crear prefactura</Button>
              </form>
            )}
          </div>

          {/* Avisos de desbalance */}
          {canSeeCosts && (charges ?? []).some((c) => !costOf(c.id)) && (
            <Notice
              error="Hay cargos sin costo asignado. Asigna el costo para ver el margen correcto."
            />
          )}

          {/* Tabla de cargos */}
          {(charges ?? []).length === 0 ? (
            <Card>
              <EmptyState
                title="Sin cargos"
                description="Registra los cargos de venta de este embarque para generar la prefactura."
              />
            </Card>
          ) : (
            <Card className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--color-border)]">
                    <tr>
                      <th className="p-3 font-semibold">Concepto</th>
                      <th className="p-3 font-semibold text-right">Cant.</th>
                      <th className="p-3 font-semibold">Unidad</th>
                      <th className="p-3 font-semibold text-right">Precio</th>
                      <th className="p-3 font-semibold">Mon.</th>
                      <th className="p-3 font-semibold text-right">Total venta</th>
                      {canSeeCosts && <th className="p-3 font-semibold text-right">Costo</th>}
                      <th className="p-3 font-semibold">Estado</th>
                      {!isTerminal && <th className="p-3 font-semibold">Acción</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(charges ?? []).map((c) => {
                      const subtotal = Math.round(c.quantity * c.unit_price * 100) / 100;
                      const tax      = Math.round(subtotal * c.tax_rate * 100) / 100;
                      const total    = Math.round((subtotal + tax) * 100) / 100;
                      const cost     = costOf(c.id);
                      return (
                        <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="p-3 text-[var(--color-text)]">
                            <div className="font-medium">{c.description}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{ctName(c.charge_type_id)}</div>
                          </td>
                          <td className="p-3 text-right text-[var(--color-text)]">{c.quantity}</td>
                          <td className="p-3 text-[var(--color-text-muted)] text-xs">{unitLabel[c.unit] ?? c.unit}</td>
                          <td className="p-3 text-right text-[var(--color-text)]">{fmtMoney(c.unit_price, c.currency)}</td>
                          <td className="p-3 text-[var(--color-text-muted)] text-xs">{c.currency}</td>
                          <td className="p-3 text-right font-semibold text-[var(--color-text)]">
                            {fmtMoney(total, c.currency)}
                            {c.tax_rate > 0 && (
                              <div className="text-xs font-normal text-[var(--color-text-muted)]">
                                +{fmtMoney(tax, c.currency)} imp.
                              </div>
                            )}
                          </td>
                          {canSeeCosts && (
                            <td className="p-3 text-right text-[var(--color-text)]">
                              {cost
                                ? fmtMoney(Number(cost.unit_cost) * c.quantity, cost.currency)
                                : <span className="text-[var(--color-text-muted)]">—</span>
                              }
                            </td>
                          )}
                          <td className="p-3">
                            {c.pre_invoice_id ? (
                              <span className="text-xs text-[var(--color-text-muted)]">Prefacturado</span>
                            ) : (
                              <span className="text-xs text-[var(--color-primary)]">Pendiente</span>
                            )}
                          </td>
                          {!isTerminal && (
                            <td className="p-3">
                              {!c.pre_invoice_id && (
                                <form action={deleteCharge}>
                                  <input type="hidden" name="id" value={c.id} />
                                  <input type="hidden" name="shipment_id" value={id} />
                                  <button
                                    type="submit"
                                    className="text-xs text-[var(--color-text-muted)] hover:text-red-600 transition-colors"
                                  >
                                    Eliminar
                                  </button>
                                </form>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totales por moneda */}
              {canSeeCosts && (marginRows ?? []).map((m) => (
                <div
                  key={m.currency}
                  className="border-t border-[var(--color-border)] p-4 flex flex-wrap gap-6 text-sm"
                >
                  <div>
                    <span className="text-[var(--color-text-muted)]">Venta</span>{" "}
                    <span className="font-semibold">{fmtMoney(Number(m.venta), m.currency)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-muted)]">Costo</span>{" "}
                    <span className="font-semibold">{fmtMoney(Number(m.costo), m.currency)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-muted)]">Margen</span>{" "}
                    <span className={`font-semibold ${Number(m.margen) < 0 ? "text-red-600" : "text-green-700"}`}>
                      {fmtMoney(Number(m.margen), m.currency)} ({Number(m.margen_pct).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* Formulario para agregar cargo */}
          {!isTerminal && (
            <Card>
              <h2 className="mb-4 font-semibold text-[var(--color-text)]">Agregar cargo</h2>
              <CargoForm
                shipmentId={id}
                accountId={ship.account_id}
                chargeTypes={(chargeTypes ?? []).map((ct) => ({
                  code: ct.code,
                  name: ct.name,
                  default_unit: ct.default_unit,
                }))}
                accounts={(allAccounts ?? []).map((a) => ({ id: a.id, name: a.name }))}
                action={createCharge}
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Tab: Documentos ── */}
      {activeTab === "documentos" && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-semibold text-[var(--color-text)]">Subir documento</h2>
            <FileDropZone action={uploadShipmentDocument} shipmentId={id} />
          </Card>

          {(shipmentDocs ?? []).length === 0 ? (
            <Card>
              <EmptyState
                title="Sin documentos"
                description="Sube BL, facturas comerciales, pólizas de seguro y más."
              />
            </Card>
          ) : (
            <Card className="p-0">
              <Table cols={["Nombre", "Tipo", "Tamaño", "Fecha", ""]}>
                {(shipmentDocs ?? []).map((doc) => (
                  <Tr key={doc.id}>
                    <Td>
                      <a
                        href={`/api/documentos/archivos/${doc.id}`}
                        className="text-[var(--color-primary)] hover:underline"
                        download
                      >
                        {doc.title}
                      </a>
                    </Td>
                    <Td>{doc.kind}</Td>
                    <Td>{doc.size_bytes < 1024 * 1024
                      ? `${(doc.size_bytes / 1024).toFixed(0)} KB`
                      : `${(doc.size_bytes / (1024 * 1024)).toFixed(1)} MB`}
                    </Td>
                    <Td>{new Date(doc.created_at).toLocaleDateString("es-DO")}</Td>
                    <Td>
                      <form action={deleteShipmentDocument}>
                        <input type="hidden" name="id" value={doc.id} />
                        <input type="hidden" name="shipment_id" value={id} />
                        <button
                          type="submit"
                          className="text-sm text-[var(--color-danger)] hover:underline"
                        >
                          Eliminar
                        </button>
                      </form>
                    </Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ── Cancelar (solo si no terminal) ── */}
      {!isTerminal && (
        <Card>
          <h2 className="mb-3 font-semibold text-[var(--color-text)]">Cancelar embarque</h2>
          <form action={cancelShipment} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="id" value={id} />
            <div className="flex-1">
              <Field
                name="reason"
                label="Motivo de cancelación"
                required
                placeholder="Ej. Cliente desistió, error de datos..."
              />
            </div>
            <Button variant="danger" type="submit">Cancelar embarque</Button>
          </form>
        </Card>
      )}
    </div>
  );
}