import { notFound } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Notice, Select, Textarea } from "@/components/ui";
import { SHIPMENT_MODES, SHIPMENT_DIRECTIONS, STAGE_LABELS } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { TERMINAL_STAGES, type StageKey } from "@/lib/stage-rules";
import { updateShipment } from "@/app/actions/shipments";
import { PortSelect } from "@/components/port-select";
import { ContainerEditor } from "@/components/container-editor";

export default async function EditarEmbarque({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, id } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: ship } = await supabase
    .from("shipments")
    .select(`id, number, stage_key, mode, direction,
             origin_port_id, destination_port_id, incoterm,
             carrier_account_id, booking_number, bl_number,
             vessel_or_flight, voyage, etd, eta,
             cargo_description, packages, weight_kg, volume_cbm,
             customer_reference, notes, internal_notes,
             shipper_account_id, consignee_account_id, notify_party_account_id`)
    .eq("id", id)
    .maybeSingle();

  if (!ship) notFound();
  if (TERMINAL_STAGES.has(ship.stage_key as StageKey)) notFound();

  const portType = ship.mode === "ocean" ? ["sea", "both"] : ["air", "both"];

  const [
    { data: ports },
    { data: carriers },
    { data: incoterms },
    { data: containers },
    { data: allAccounts },
    { data: containerTypes },
  ] = await Promise.all([
    supabase.from("ports").select("code, name, country_code, type, is_featured")
      .in("type", portType),
    supabase.from("accounts").select("id, name")
      .eq("tenant_id", tenant.id).in("kind", ["carrier"]).order("name"),
    supabase.from("incoterms").select("code, name").order("code"),
    supabase.from("shipment_containers").select("*").eq("shipment_id", id).order("created_at"),
    supabase.from("accounts").select("id, name")
      .eq("tenant_id", tenant.id).order("name"),
    supabase.from("container_types").select("code, name"),
  ]);

  const modeOptions = SHIPMENT_MODES.map((m) => ({ value: m.value, label: m.label }));
  const dirOptions  = SHIPMENT_DIRECTIONS.map((d) => ({ value: d.value, label: d.label }));

  const carrierOptions = [
    { value: "", label: "— Sin asignar —" },
    ...(carriers ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const incotermOptions = [
    { value: "", label: "— Seleccionar —" },
    ...(incoterms ?? []).map((i) => ({ value: i.code, label: `${i.code} — ${i.name}` })),
  ];

  const accountOptions = [
    { value: "", label: "— Sin asignar —" },
    ...(allAccounts ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const stageLabel = STAGE_LABELS[ship.stage_key as StageKey] ?? ship.stage_key;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Editar embarque</p>
          <h1 className="text-xl font-bold text-[var(--color-text)]">
            {ship.number} · {stageLabel}
          </h1>
        </div>
        <Link href={`/embarques/${id}`}>
          <Button variant="ghost" type="button">← Volver a la ficha</Button>
        </Link>
      </div>

      <Notice error={errorMsg} />

      <form action={updateShipment} className="space-y-5">
        <input type="hidden" name="id" value={id} />

        {/* Ruta */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Ruta</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select name="mode"      label="Modo de transporte" options={modeOptions}      defaultValue={ship.mode      ?? ""} />
            <Select name="direction" label="Dirección"          options={dirOptions}       defaultValue={ship.direction ?? ""} />
            <PortSelect
              name="origin_port_id"
              label="Puerto de origen"
              initialPorts={ports ?? []}
              defaultValue={ship.origin_port_id ?? ""}
              required={false}
            />
            <PortSelect
              name="destination_port_id"
              label="Puerto de destino"
              initialPorts={ports ?? []}
              defaultValue={ship.destination_port_id ?? ""}
              required={false}
            />
            <Select name="incoterm"           label="Incoterm"            options={incotermOptions}  defaultValue={ship.incoterm           ?? ""} />
            <Select name="carrier_account_id" label="Naviera / Aerolínea" options={carrierOptions}   defaultValue={ship.carrier_account_id ?? ""} />
          </div>
        </Card>

        {/* Carga */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Carga</h2>
          <div className="space-y-4">
            <Textarea
              name="cargo_description"
              label="Descripción de la carga"
              defaultValue={ship.cargo_description ?? ""}
              rows={3}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="packages"   label="Bultos"       type="number" defaultValue={ship.packages?.toString()   ?? ""} />
              <Field name="weight_kg"  label="Peso (kg)"    type="number" defaultValue={ship.weight_kg?.toString()  ?? ""} />
              <Field name="volume_cbm" label="Volumen (m³)" type="number" defaultValue={ship.volume_cbm?.toString() ?? ""} />
            </div>
          </div>
        </Card>

        {/* Contenedores (solo marítimo) */}
        {ship.mode === "ocean" && (
          <Card>
            <h2 className="mb-4 font-semibold text-[var(--color-text)]">Contenedores</h2>
            <ContainerEditor initialContainers={containers ?? []} containerTypes={containerTypes ?? []} />
          </Card>
        )}

        {/* Fechas y referencias */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Fechas y referencias</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="etd"              label="ETD (salida estimada)" type="date" defaultValue={ship.etd              ?? ""} />
            <Field name="eta"              label="ETA (llegada estimada)" type="date" defaultValue={ship.eta              ?? ""} />
            <Field name="booking_number"   label="Número de booking"     defaultValue={ship.booking_number   ?? ""} />
            <Field name="bl_number"        label="Número de BL"          defaultValue={ship.bl_number        ?? ""} />
            <Field name="vessel_or_flight" label="Nave o vuelo"          defaultValue={ship.vessel_or_flight ?? ""} />
            <Field name="voyage"           label="Viaje"                 defaultValue={ship.voyage           ?? ""} />
            <Field name="customer_reference" label="Referencia del cliente" defaultValue={ship.customer_reference ?? ""} />
          </div>
        </Card>

        {/* Partes involucradas */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Partes involucradas</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              name="shipper_account_id"
              label="Embarcador"
              options={accountOptions}
              defaultValue={ship.shipper_account_id ?? ""}
            />
            <Select
              name="consignee_account_id"
              label="Consignatario"
              options={accountOptions}
              defaultValue={ship.consignee_account_id ?? ""}
            />
            <Select
              name="notify_party_account_id"
              label="Notify party"
              options={accountOptions}
              defaultValue={ship.notify_party_account_id ?? ""}
            />
          </div>
        </Card>

        {/* Notas */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Notas</h2>
          <div className="space-y-4">
            <Textarea
              name="notes"
              label="Notas (visibles para el cliente)"
              defaultValue={ship.notes ?? ""}
              rows={3}
            />
            <Textarea
              name="internal_notes"
              label="Notas internas"
              defaultValue={ship.internal_notes ?? ""}
              rows={3}
            />
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Link href={`/embarques/${id}`}>
            <Button type="button" variant="ghost">Cancelar</Button>
          </Link>
          <Button type="submit">Guardar cambios</Button>
        </div>
      </form>
    </div>
  );
}