import { createClient } from "@/lib/supabase/server";
import { decode } from "@/lib/messages";
import {
  PageHeader, Card, Notice,
  Tabs, Table, Td, Badge,
} from "@/components/ui";

const AJUSTES_TABS = [
  { value: "empresa",        label: "Empresa",        href: "/ajustes/empresa"        },
  { value: "numeracion",     label: "Numeración",     href: "/ajustes/numeracion"     },
  { value: "equipo",         label: "Equipo",         href: "/ajustes/equipo"         },
  { value: "cargos",         label: "Cargos",         href: "/ajustes/cargos"         },
  { value: "integracion",    label: "Integración",    href: "/ajustes/integracion"    },
  { value: "plantillas",     label: "Plantillas",     href: "/ajustes/plantillas"     },
  { value: "notificaciones", label: "Notificaciones", href: "/ajustes/notificaciones" },
];

type ChargeType = {
  code:         string;
  name:         string;
  default_unit: string | null;
  itbis_aplica: boolean;
};

export default async function AjustesCargos({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();

  const { data: charges } = await supabase
    .from("charge_types")
    .select("code,name,default_unit,itbis_aplica")
    .order("code") as { data: ChargeType[] | null };

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" />
      <Tabs tabs={AJUSTES_TABS} active="cargos" />
      <Notice error={decode(error)} info={decode(ok)} />

      <Card className="p-0">
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            Catálogo de categorías de cargo. Fijo para todos los embarques y cotizaciones.
            Las categorías marcadas como ITBIS aplican 18% automáticamente.
          </p>
        </div>
        <Table cols={["Código", "Nombre", "Unidad por defecto", "ITBIS"]}>
          {(charges ?? []).map((c) => (
            <tr key={c.code}
              className="border-b border-[var(--color-border)] last:border-0">
              <Td><span className="font-mono text-xs font-medium">{c.code}</span></Td>
              <Td>{c.name}</Td>
              <Td className="text-[var(--color-text-muted)]">{c.default_unit ?? "—"}</Td>
              <Td>
                {c.itbis_aplica
                  ? <Badge color="info">Sí (18%)</Badge>
                  : <span className="text-xs text-[var(--color-text-muted)]">No</span>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
