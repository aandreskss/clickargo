import { notFound } from "next/navigation";
import { Button, Card, Field, Notice, Select, Stepper, Textarea } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { updateShipmentStep2 } from "@/app/actions/shipments";
import { PortSelect } from "@/components/port-select";
import { ContainerEditor } from "@/components/container-editor";

const STEPS = [
  { label: "Cliente y modo" },
  { label: "Ruta y carga" },
  { label: "Fechas y referencias" },
];

export default async function PasoRuta({
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
             origin_port_id, destination_port_id, incoterm,
             carrier_account_id, cargo_description,
             packages, weight_kg, volume_cbm`)
    .eq("id", id)
    .maybeSingle();

  if (!ship || ship.stage_key !== "draft") notFound();

  const portType = ship.mode === "ocean" ? ["sea", "both"] : ["air", "both"];

  const [{ data: ports }, { data: carriers }, { data: incoterms }, { data: containers }, { data: containerTypes }] =
    await Promise.all([
      supabase.from("ports").select("code, name, country_code, type, is_featured")
        .in("type", portType),
      supabase.from("accounts").select("id, name")
        .eq("tenant_id", tenant.id)
        .in("kind", ["carrier"])
        .order("name"),
      supabase.from("incoterms").select("code, name").order("code"),
      supabase.from("shipment_containers").select("*").eq("shipment_id", id),
      supabase.from("container_types").select("code, name"),
    ]);

  const carrierOptions = [
    { value: "", label: "— Sin asignar —" },
    ...(carriers ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const incotermOptions = [
    { value: "", label: "— Seleccionar —" },
    ...(incoterms ?? []).map((i) => ({ value: i.code, label: `${i.code} — ${i.name}` })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--color-text-muted)]">Embarque</p>
        <h1 className="text-xl font-bold text-[var(--color-text)]">{ship.number}</h1>
      </div>

      <Stepper steps={STEPS} current={1} />
      <Notice error={errorMsg} />

      <form action={updateShipmentStep2} className="space-y-4">
        <input type="hidden" name="id" value={id} />

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Ruta</h2>
          <div className="grid gap-4 sm:grid-cols-2">
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
            <Select
              name="incoterm"
              label="Incoterm"
              options={incotermOptions}
              defaultValue={ship.incoterm ?? ""}
            />
            <Select
              name="carrier_account_id"
              label="Naviera o aerolínea"
              options={carrierOptions}
              defaultValue={ship.carrier_account_id ?? ""}
            />
          </div>
        </Card>

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
              <Field name="packages"  label="Bultos"       type="number" defaultValue={ship.packages?.toString()  ?? ""} />
              <Field name="weight_kg" label="Peso (kg)"    type="number" defaultValue={ship.weight_kg?.toString() ?? ""} />
              <Field name="volume_cbm" label="Volumen (m³)" type="number" defaultValue={ship.volume_cbm?.toString() ?? ""} />
            </div>
          </div>
        </Card>

        {ship.mode === "ocean" && (
          <Card>
            <h2 className="mb-4 font-semibold text-[var(--color-text)]">Contenedores</h2>
            <ContainerEditor initialContainers={containers ?? []} containerTypes={containerTypes ?? []} />
          </Card>
        )}

        <div className="flex justify-end gap-3">
          <a href={`/embarques/${id}/paso/2`}>
            <Button type="button" variant="ghost">← Anterior</Button>
          </a>
          <Button type="submit">Siguiente →</Button>
        </div>
      </form>
    </div>
  );
}