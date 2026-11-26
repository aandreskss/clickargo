import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { decode } from "@/lib/messages";
import { updateCounter } from "@/app/actions/settings";
import { PageHeader, Card, Field, Button, Notice, Tabs, Table, Td } from "@/components/ui";

const AJUSTES_TABS = [
  { value: "empresa",     label: "Empresa",     href: "/ajustes/empresa"     },
  { value: "numeracion",  label: "Numeración",  href: "/ajustes/numeracion"  },
  { value: "equipo",      label: "Equipo",      href: "/ajustes/equipo"      },
  { value: "cargos",      label: "Cargos",      href: "/ajustes/cargos"      },
  { value: "integracion", label: "Integración", href: "/ajustes/integracion" },
  { value: "plantillas",  label: "Plantillas",  href: "/ajustes/plantillas"  },
];

const COUNTER_DEFS = [
  { key: "quotes",     label: "Cotizaciones",  defaultPrefix: "COT-" },
  { key: "shipments",  label: "Embarques",     defaultPrefix: "EMB-" },
  { key: "prefactura", label: "Prefacturas",   defaultPrefix: "PF-"  },
] as const;

export default async function AjustesNumeracion({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { data: t } = await supabase
    .from("tenants").select("settings").eq("id", tenant.id).maybeSingle();

  const countersSettings = ((t?.settings as Record<string, unknown>)?.counters ?? {}) as Record<string, {
    prefix: string; next_value: number;
  }>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajustes"
        subtitle="Configura el prefijo y el próximo número para cada tipo de documento."
      />
      <Tabs tabs={AJUSTES_TABS} active="numeracion" />
      <Notice error={decode(error)} info={decode(ok)} />

      <Card className="p-0">
        <Table cols={["Documento", "Configuración"]}>
          {COUNTER_DEFS.map((def) => {
            const saved      = countersSettings[def.key];
            const prefix     = saved?.prefix     ?? def.defaultPrefix;
            const next_value = (saved?.next_value ?? 0) + 1;
            return (
              <tr key={def.key} className="border-b border-[var(--color-border)] last:border-0">
                <Td>
                  <p className="font-medium">{def.label}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Próximo: {prefix}{String(next_value).padStart(6, "0")}
                  </p>
                </Td>
                <Td>
                  <form action={updateCounter} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="key" value={def.key} />
                    <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                      Prefijo
                      <input
                        name="prefix"
                        defaultValue={prefix}
                        maxLength={10}
                        className="ml-1 w-20 rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                      Siguiente #
                      <input
                        name="next_value"
                        type="number"
                        min={1}
                        max={999999}
                        defaultValue={next_value}
                        className="ml-1 w-20 rounded-[var(--radius)] border border-[var(--color-border)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
                      />
                    </label>
                    <Button variant="secondary" type="submit">Guardar</Button>
                  </form>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
