import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { decode } from "@/lib/messages";
import {
  inviteMember, changeRole, toggleCanSeeCosts,
  deactivateMember, reactivateMember,
} from "@/app/actions/team";
import {
  PageHeader, Card, Field, Select, Button, Notice,
  Tabs, Table, Td, Badge, EmptyState,
} from "@/components/ui";
import { ASSIGNABLE_ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";

const AJUSTES_TABS = [
  { value: "empresa",     label: "Empresa",     href: "/ajustes/empresa"     },
  { value: "numeracion",  label: "Numeración",  href: "/ajustes/numeracion"  },
  { value: "equipo",      label: "Equipo",      href: "/ajustes/equipo"      },
  { value: "cargos",      label: "Cargos",      href: "/ajustes/cargos"      },
  { value: "integracion",    label: "Integración",    href: "/ajustes/integracion"    },
  { value: "plantillas",     label: "Plantillas",     href: "/ajustes/plantillas"     },
  { value: "notificaciones", label: "Notificaciones", href: "/ajustes/notificaciones" },
];

type Member = {
  membership_id: string;
  user_id:       string;
  full_name:     string | null;
  email:         string;
  role:          string;
  can_see_costs: boolean;
  is_active:     boolean;
};

export default async function AjustesEquipo({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: members } = await supabase.rpc("list_team_members", { _tenant: tenant.id }) as {
    data: Member[] | null;
  };

  const activeOwners = (members ?? []).filter((m) => m.role === "owner" && m.is_active).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" />
      <Tabs tabs={AJUSTES_TABS} active="equipo" />
      <Notice error={decode(error)} info={decode(ok)} />

      {/* ── Invitar ── */}
      <Card>
        <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">Invitar miembro</h2>
        <form action={inviteMember} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-48">
            <Field label="Correo electrónico" name="email" type="email" placeholder="nombre@empresa.com" />
          </div>
          <div className="w-48">
            <Select label="Rol" name="role" options={ASSIGNABLE_ROLES} />
          </div>
          <Button>Enviar invitación</Button>
        </form>
      </Card>

      {/* ── Lista de miembros ── */}
      <Card className="p-0">
        {members?.length ? (
          <Table cols={["Miembro", "Rol", "Ve costos", "Estado", "Acciones"]}>
            {members.map((m) => {
              const isLastOwner = m.role === "owner" && activeOwners <= 1;
              const isSelf      = m.user_id === user?.id;
              return (
                <tr key={m.membership_id}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                  <Td>
                    <p className="font-medium">{m.full_name ?? "—"}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{m.email}</p>
                  </Td>
                  <Td>
                    {isSelf || isLastOwner ? (
                      <span className="text-sm">{ROLE_LABELS[m.role as Role] ?? m.role}</span>
                    ) : (
                      <form action={changeRole} className="inline">
                        <input type="hidden" name="membership_id" value={m.membership_id} />
                        <select
                          name="role"
                          defaultValue={m.role}
                          onChange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
                          className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] outline-none">
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </form>
                    )}
                  </Td>
                  <Td>
                    <form action={toggleCanSeeCosts}>
                      <input type="hidden" name="membership_id" value={m.membership_id} />
                      <input type="hidden" name="can_see_costs" value={String(!m.can_see_costs)} />
                      <button type="submit"
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${m.can_see_costs ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"}`}>
                        <span className={`inline-block h-4 w-4 rounded-full bg-[var(--color-surface)] shadow transition-transform ${m.can_see_costs ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                    </form>
                  </Td>
                  <Td>
                    <Badge color={m.is_active ? "success" : "default"}>
                      {m.is_active ? "Activo" : "Inactivo"}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      {!isSelf && !isLastOwner && m.is_active && (
                        <form action={deactivateMember}>
                          <input type="hidden" name="membership_id" value={m.membership_id} />
                          <Button variant="ghost" type="submit">Desactivar</Button>
                        </form>
                      )}
                      {!m.is_active && (
                        <form action={reactivateMember}>
                          <input type="hidden" name="membership_id" value={m.membership_id} />
                          <Button variant="secondary" type="submit">Reactivar</Button>
                        </form>
                      )}
                      {isLastOwner && (
                        <span className="text-xs text-[var(--color-text-muted)]" title="No puedes dejar la empresa sin dueño">
                          Último dueño
                        </span>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState
            title="Sin miembros"
            description="Invita a tu equipo con el formulario de arriba."
          />
        )}
      </Card>
    </div>
  );
}
