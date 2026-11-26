import { notFound } from "next/navigation";
import Link from "next/link";
import { Button, Card, Field, Notice, Select, Textarea } from "@/components/ui";
import { SHIPMENT_MODES } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { PortSelect, type Port } from "@/components/port-select";
import { updateMaster } from "@/app/actions/masters";
import { env } from "@/lib/env";

const TRACKING_PROVIDERS = [
  { value: "manual",     label: "Manual (sin proveedor externo)" },
  { value: "terminal49", label: "Terminal49" },
];

export default async function EditarMasterPage({
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

  const [{ data: master }, { data: accounts }, { data: ports }] = await Promise.all([
    supabase
      .from("masters")
      .select(`id, number, master_number, mode, carrier_account_id,
               vessel_or_flight, voyage, origin_port_id, destination_port_id,
               etd, eta, atd, ata, notes, tracking_enabled,
               tracking_provider, tracking_ref, stage_key`)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("accounts").select("id, name, kind").in("kind", ["carrier"]).order("name"),
    supabase.from("ports").select("code, name, country_code, type, is_featured").order("is_featured", { ascending: false }).order("name").limit(300),
  ]);

  if (!master) notFound();

  const carrierOptions = [
    { value: "", label: "— Sin asignar —" },
    ...(accounts ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const isTerminal49Configured =
    env.TRACKING_PROVIDER === "terminal49" && !!env.TERMINAL49_API_KEY;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            Editar master {master.number}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Modifica los datos del BL maestro.
          </p>
        </div>
        <Link href={`/masters/${id}`}>
          <Button variant="ghost" type="button">← Volver</Button>
        </Link>
      </div>

      <Notice error={errorMsg} />

      {!isTerminal49Configured && (
        <Notice
          info="El tracking automático está en modo manual. Para activar Terminal49, configura las variables de entorno correspondientes."
        />
      )}

      <form action={updateMaster} className="space-y-4">
        <input type="hidden" name="id" value={id} />

        {/* Datos básicos */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Datos del master</h2>
          <div className="space-y-4">
            <Field
              name="master_number"
              label="Número de MBL / MAWB"
              defaultValue={master.master_number ?? ""}
              placeholder="Ej. MAEU123456789"
              hint="Número del Bill of Lading maestro o guía aérea master."
            />
            <Select
              name="mode"
              label="Modo de transporte"
              options={SHIPMENT_MODES}
              defaultValue={master.mode ?? "ocean"}
              required
            />
            <Select
              name="carrier_account_id"
              label="Naviera / Aerolínea"
              options={carrierOptions}
              defaultValue={master.carrier_account_id ?? ""}
              required={false}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="vessel_or_flight"
                label="Nave o vuelo"
                defaultValue={master.vessel_or_flight ?? ""}
                placeholder="Ej. MSC DIANA"
                required={false}
              />
              <Field
                name="voyage"
                label="Número de viaje"
                defaultValue={master.voyage ?? ""}
                placeholder="Ej. 240W"
                required={false}
              />
            </div>
          </div>
        </Card>

        {/* Puertos */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Ruta</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <PortSelect
              name="origin_port_id"
              label="Puerto / aeropuerto de origen"
              defaultValue={master.origin_port_id ?? ""}
              initialPorts={(ports ?? []) as Port[]}
              required={false}
            />
            <PortSelect
              name="destination_port_id"
              label="Puerto / aeropuerto de destino"
              defaultValue={master.destination_port_id ?? ""}
              initialPorts={(ports ?? []) as Port[]}
              required={false}
            />
          </div>
        </Card>

        {/* Fechas */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Fechas</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="etd" label="ETD — Salida estimada" type="date" defaultValue={master.etd ?? ""} required={false} />
            <Field name="eta" label="ETA — Llegada estimada" type="date" defaultValue={master.eta ?? ""} required={false} />
            <Field name="atd" label="ATD — Salida real"     type="date" defaultValue={master.atd ?? ""} required={false} />
            <Field name="ata" label="ATA — Llegada real"    type="date" defaultValue={master.ata ?? ""} required={false} />
          </div>
        </Card>

        {/* Tracking */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Tracking</h2>
          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="tracking_enabled"
                value="true"
                defaultChecked={master.tracking_enabled ?? false}
                className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
              />
              <span className="text-sm font-medium text-[var(--color-text)]">
                Habilitar tracking
              </span>
            </label>
            <Select
              name="tracking_provider"
              label="Proveedor de tracking"
              options={TRACKING_PROVIDERS}
              defaultValue={master.tracking_provider ?? "manual"}
              required={false}
            />
            <Field
              name="tracking_ref"
              label="Referencia de tracking"
              defaultValue={master.tracking_ref ?? ""}
              placeholder="Número de MBL o contenedor"
              required={false}
            />
          </div>
        </Card>

        {/* Notas */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Notas</h2>
          <Textarea name="notes" label="Notas" required={false} rows={3} defaultValue={master.notes ?? ""} />
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Guardar cambios</Button>
          <Link href={`/masters/${id}`}>
            <Button variant="ghost" type="button">Cancelar</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
