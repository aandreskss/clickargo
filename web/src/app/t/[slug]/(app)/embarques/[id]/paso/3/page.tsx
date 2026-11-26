import { notFound } from "next/navigation";
import { Button, Card, Field, Notice, Select, Stepper, Textarea } from "@/components/ui";
import { SHIPMENT_MODES, SHIPMENT_DIRECTIONS, STAGE_LABELS } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { updateShipmentStep3 } from "@/app/actions/shipments";

const STEPS = [
  { label: "Cliente y modo" },
  { label: "Ruta y carga" },
  { label: "Fechas y referencias" },
];

export default async function PasoFechas({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, id } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);
  const supabase = await createClient();

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: ship } = await supabase
    .from("shipments")
    .select(`id, number, mode, direction, stage_key,
             booking_number, bl_number, vessel_or_flight, voyage,
             etd, eta, customer_reference,
             shipper_account_id, consignee_account_id, notify_party_account_id,
             notes, internal_notes,
             origin_port_id, destination_port_id, account_id`)
    .eq("id", id)
    .maybeSingle();

  if (!ship || ship.stage_key !== "draft") notFound();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .order("name");

  const acctOptions = [
    { value: "", label: "— Sin asignar —" },
    ...(accounts ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const modeLabel = SHIPMENT_MODES.find((m) => m.value === ship.mode)?.label ?? ship.mode;
  const dirLabel  = SHIPMENT_DIRECTIONS.find((d) => d.value === ship.direction)?.label ?? ship.direction;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--color-text-muted)]">Embarque</p>
        <h1 className="text-xl font-bold text-[var(--color-text)]">{ship.number}</h1>
      </div>

      <Stepper steps={STEPS} current={2} />
      <Notice error={errorMsg} />

      <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
        {modeLabel} · {dirLabel} · {[ship.origin_port_id, ship.destination_port_id].filter(Boolean).join(" → ") || "Ruta sin definir"}
      </div>

      <form action={updateShipmentStep3} className="space-y-4">
        <input type="hidden" name="id" value={id} />

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Fechas estimadas</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="etd" label="ETD — Salida estimada" type="date" defaultValue={ship.etd ?? ""} />
            <Field name="eta" label="ETA — Llegada estimada" type="date" defaultValue={ship.eta ?? ""} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Referencias y números</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="booking_number"     label="Número de booking"   defaultValue={ship.booking_number    ?? ""} />
            <Field name="bl_number"          label="BL / HAWB"           defaultValue={ship.bl_number         ?? ""} />
            <Field name="vessel_or_flight"   label="Buque o vuelo"       defaultValue={ship.vessel_or_flight  ?? ""} />
            <Field name="voyage"             label="Viaje / Vuelo No."   defaultValue={ship.voyage            ?? ""} />
            <Field name="customer_reference" label="Referencia del cliente" defaultValue={ship.customer_reference ?? ""} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Partes involucradas</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select name="shipper_account_id"       label="Remitente"      options={acctOptions} defaultValue={ship.shipper_account_id       ?? ""} />
            <Select name="consignee_account_id"     label="Consignatario"  options={acctOptions} defaultValue={ship.consignee_account_id     ?? ""} />
            <Select name="notify_party_account_id"  label="Notify party"   options={acctOptions} defaultValue={ship.notify_party_account_id  ?? ""} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Notas</h2>
          <div className="space-y-3">
            <Textarea name="notes"          label="Notas al cliente"  defaultValue={ship.notes          ?? ""} rows={3} />
            <Textarea name="internal_notes" label="Notas internas"    defaultValue={ship.internal_notes ?? ""} rows={3} />
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <a href={`/embarques/${id}/paso/2`}>
            <Button type="button" variant="ghost">← Anterior</Button>
          </a>
          <Button type="submit">Crear embarque</Button>
        </div>
      </form>
    </div>
  );
}