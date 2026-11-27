import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { decode } from "@/lib/messages";
import { createChargeType, updateChargeType, deactivateChargeType, seedChargeTypes } from "@/app/actions/settings";
import {
  PageHeader, Card, Field, Button, Notice,
  Tabs, Table, Td, Badge, EmptyState,
} from "@/components/ui";

const AJUSTES_TABS = [
  { value: "empresa",     label: "Empresa",     href: "/ajustes/empresa"     },
  { value: "numeracion",  label: "Numeración",  href: "/ajustes/numeracion"  },
  { value: "equipo",      label: "Equipo",      href: "/ajustes/equipo"      },
  { value: "cargos",      label: "Cargos",      href: "/ajustes/cargos"      },
  { value: "integracion",    label: "Integración",    href: "/ajustes/integracion"    },
  { value: "plantillas",     label: "Plantillas",     href: "/ajustes/plantillas"     },
  { value: "notificaciones", label: "Notificaciones", href: "/ajustes/notificaciones" },
];

type ChargeType = {
  id:           string;
  code:         string;
  name:         string;
  default_unit: string | null;
  taxable:      boolean;
  active:       boolean;
};

export default async function AjustesCargos({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string; edit?: string }>;
}) {
  const { ok, error, edit } = await searchParams;
  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { data: charges } = await supabase
    .from("charge_types")
    .select("id,code,name,default_unit,taxable,active")
    .eq("tenant_id", tenant.id)
    .order("active", { ascending: false })
    .order("code") as { data: ChargeType[] | null };

  const editing = edit ? (charges ?? []).find((c) => c.id === edit) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" />
      <Tabs tabs={AJUSTES_TABS} active="cargos" />
      <Notice error={decode(error)} info={decode(ok)} />

      {/* ── Formulario nuevo / editar ── */}
      <Card>
        <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">
          {editing ? `Editar cargo: ${editing.name}` : "Nuevo tipo de cargo"}
        </h2>
        <form action={editing ? updateChargeType : createChargeType}
          className="grid gap-4 sm:grid-cols-2">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <Field label="Código" name="code" placeholder="FLT-MAR" defaultValue={editing?.code ?? ""}
            hint="Máximo 10 caracteres." />
          <Field label="Nombre" name="name" placeholder="Flete marítimo" defaultValue={editing?.name ?? ""} />
          <Field label="Unidad por defecto" name="default_unit" placeholder="BL, KG, CONT…"
            defaultValue={editing?.default_unit ?? ""} required={false}
            hint="Aparecerá como sugerencia al agregar este cargo en cotizaciones." />
          <div className="flex items-center gap-3 pt-5">
            <input type="checkbox" id="taxable" name="taxable" value="true"
              defaultChecked={editing?.taxable ?? false}
              className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]" />
            <label htmlFor="taxable" className="text-sm text-[var(--color-text)]">Aplica ITBIS (18%)</label>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            {editing && (
              <a href="/ajustes/cargos">
                <Button variant="ghost" type="button">Cancelar</Button>
              </a>
            )}
            <Button>{editing ? "Guardar cambios" : "Agregar cargo"}</Button>
          </div>
        </form>
      </Card>

      {/* ── Lista ── */}
      <Card className="p-0">
        {charges?.length ? (
          <Table cols={["Código", "Nombre", "Unidad", "ITBIS", "Estado", ""]}>
            {charges.map((c) => (
              <tr key={c.id}
                className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                <Td><span className="font-mono text-xs font-medium">{c.code}</span></Td>
                <Td>{c.name}</Td>
                <Td className="text-[var(--color-text-muted)]">{c.default_unit ?? "—"}</Td>
                <Td>{c.taxable ? <Badge color="info">Sí</Badge> : <span className="text-xs text-[var(--color-text-muted)]">No</span>}</Td>
                <Td>
                  <Badge color={c.active ? "success" : "default"}>
                    {c.active ? "Activo" : "Inactivo"}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <a href={`/ajustes/cargos?edit=${c.id}`}>
                      <Button variant="ghost" type="button">Editar</Button>
                    </a>
                    {c.active && (
                      <form action={deactivateChargeType}>
                        <input type="hidden" name="id" value={c.id} />
                        <Button variant="ghost" type="submit">Desactivar</Button>
                      </form>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title="Sin tipos de cargo"
            description="Puedes agregar los tuyos arriba o sembrar los cargos más comunes."
            action={{ label: "Sembrar cargos por defecto", href: "#" }}
          />
        )}
      </Card>

      {/* ── Sembrar (siempre visible como opción secundaria) ── */}
      {(!charges || charges.length === 0) && (
        <form action={seedChargeTypes} className="flex justify-center">
          <Button variant="secondary">Sembrar cargos por defecto</Button>
        </form>
      )}
    </div>
  );
}
