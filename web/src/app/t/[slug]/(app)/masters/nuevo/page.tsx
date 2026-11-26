import Link from "next/link";
import { Button, Card, Field, Notice, Select, Textarea } from "@/components/ui";
import { SHIPMENT_MODES } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { PortSelect, type Port } from "@/components/port-select";
import { createMaster } from "@/app/actions/masters";
import { env } from "@/lib/env";

const TRACKING_PROVIDERS = [
  { value: "manual",     label: "Manual (sin proveedor externo)" },
  { value: "terminal49", label: "Terminal49" },
];

export default async function NuevoMasterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const [{ data: accounts }, { data: ports }] = await Promise.all([
    supabase.from("accounts").select("id, name, kind").in("kind", ["carrier"]).order("name"),
    supabase.from("ports").select("code, name, country_code, type, is_featured").order("is_featured", { ascending: false }).order("name").limit(300),
  ]);

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
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Nuevo master</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Crea un BL maestro para agrupar embarques.
          </p>
        </div>
        <Link href="/masters">
          <Button variant="ghost" type="button">← Volver</Button>
        </Link>
      </div>

      <Notice error={errorMsg} />

      {!isTerminal49Configured && (
        <Notice
          info="El tracking automático está en modo manual. Para activar el tracking con Terminal49, configura TRACKING_PROVIDER=terminal49 y TERMINAL49_API_KEY en las variables de entorno."
        />
      )}

      <form action={createMaster} className="space-y-4">
        {/* Datos básicos */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Datos del master</h2>
          <div className="space-y-4">
            <Field
              name="master_number"
              label="Número de MBL / MAWB"
              placeholder="Ej. MAEU123456789"
              hint="Número del Bill of Lading maestro o guía aérea master."
            />
            <Select
              name="mode"
              label="Modo de transporte"
              options={SHIPMENT_MODES}
              required
            />
            <Select
              name="carrier_account_id"
              label="Naviera / Aerolínea"
              options={carrierOptions}
              required={false}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="vessel_or_flight"
                label="Nave o vuelo"
                placeholder="Ej. MSC DIANA"
                required={false}
              />
              <Field
                name="voyage"
                label="Número de viaje"
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
              initialPorts={(ports ?? []) as Port[]}
              required={false}
            />
            <PortSelect
              name="destination_port_id"
              label="Puerto / aeropuerto de destino"
              initialPorts={(ports ?? []) as Port[]}
              required={false}
            />
          </div>
        </Card>

        {/* Fechas */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Fechas estimadas</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="etd" label="ETD — Salida estimada" type="date" required={false} />
            <Field name="eta" label="ETA — Llegada estimada" type="date" required={false} />
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
              required={false}
            />
            <Field
              name="tracking_ref"
              label="Referencia de tracking"
              placeholder="Número de MBL o contenedor que monitorea el proveedor"
              required={false}
              hint="Generalmente el mismo MBL/MAWB. Algunos proveedores aceptan el número de contenedor."
            />
          </div>
        </Card>

        {/* Notas */}
        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Notas</h2>
          <Textarea name="notes" label="Notas" required={false} rows={3} />
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Guardar master</Button>
          <Link href="/masters">
            <Button variant="ghost" type="button">Cancelar</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
