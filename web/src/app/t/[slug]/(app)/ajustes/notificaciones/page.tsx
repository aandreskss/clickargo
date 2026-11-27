import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { decode } from "@/lib/messages";
import { upsertNotificationPreferences } from "@/app/actions/portal";
import { PageHeader, Card, Button, Notice, Tabs, EmptyState, Table, Td, Tr } from "@/components/ui";

const AJUSTES_TABS = [
  { value: "empresa",        label: "Empresa",        href: "/ajustes/empresa"        },
  { value: "numeracion",     label: "Numeración",     href: "/ajustes/numeracion"     },
  { value: "equipo",         label: "Equipo",         href: "/ajustes/equipo"         },
  { value: "cargos",         label: "Cargos",         href: "/ajustes/cargos"         },
  { value: "integracion",    label: "Integración",    href: "/ajustes/integracion"    },
  { value: "plantillas",     label: "Plantillas",     href: "/ajustes/plantillas"     },
  { value: "notificaciones", label: "Notificaciones", href: "/ajustes/notificaciones" },
];

const EVENT_KINDS = [
  { kind: "stage_changed",  label: "Cambio de etapa"             },
  { kind: "eta_changed",    label: "Cambio de fecha estimada"     },
  { kind: "document_added", label: "Nuevo documento disponible"  },
];

export default async function AjustesNotificaciones({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  // Clientes del portal (memberships con role='customer') para cada cuenta
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .eq("kind", "customer")
    .order("name");

  // Preferencias existentes
  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("account_id, event_kind, enabled, emails")
    .eq("tenant_id", tenant.id);

  function getPref(accountId: string, kind: string) {
    return prefs?.find((p) => p.account_id === accountId && p.event_kind === kind);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Notificaciones" />
      <Tabs tabs={AJUSTES_TABS} active="notificaciones" />
      <Notice info={decode(ok)} error={decode(error)} />

      {(accounts ?? []).length === 0 ? (
        <Card>
          <EmptyState
            title="Sin clientes registrados"
            description="Registra clientes tipo 'cliente' para configurar sus notificaciones."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {(accounts ?? []).map((account) => (
            <Card key={account.id}>
              <h3 className="mb-4 font-semibold">{account.name}</h3>
              <Table cols={["Evento", "Habilitado", "Correos destinatarios", ""]}>
                {EVENT_KINDS.map(({ kind, label }) => {
                  const pref = getPref(account.id, kind);
                  return (
                    <Tr key={kind}>
                      <Td className="font-medium">{label}</Td>
                      <Td>{pref?.enabled ? "Sí" : "No"}</Td>
                      <Td className="text-sm text-[var(--color-text-muted)]">
                        {pref?.emails?.join(", ") || "—"}
                      </Td>
                      <Td>
                        <form action={upsertNotificationPreferences} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input type="hidden" name="account_id" value={account.id} />
                          <input type="hidden" name="kind" value={kind} />
                          <select
                            name="enabled"
                            defaultValue={pref?.enabled ? "true" : "false"}
                            className="rounded border border-[var(--color-border)] px-2 py-1 text-sm"
                          >
                            <option value="true">Habilitado</option>
                            <option value="false">Deshabilitado</option>
                          </select>
                          <input
                            name="emails"
                            defaultValue={pref?.emails?.join(", ") ?? ""}
                            placeholder="correo1@ejemplo.com, correo2@ejemplo.com"
                            className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-sm"
                          />
                          <Button type="submit" variant="ghost">Guardar</Button>
                        </form>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
