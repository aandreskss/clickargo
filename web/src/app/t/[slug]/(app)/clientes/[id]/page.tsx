import { notFound } from "next/navigation";
import { deleteAccount, updateAccount } from "@/app/actions/accounts";
import { inviteCustomerToPortal, revokePortalAccess } from "@/app/actions/portal";
import { AccountForm } from "@/components/account-form";
import { Badge, Button, Card, Field, Notice, Table, Td, Tr } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function EditarCuenta({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { slug, id } = await params;
  const { error, ok } = await searchParams;
  const errorMsg = decode(error);
  const okMsg    = decode(ok);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: t }, { data: account }, { data: portalMembers }] = await Promise.all([
    supabase.rpc("tenant_by_slug", { _slug: slug }),
    supabase.from("accounts").select("*").eq("id", id).maybeSingle(),
    // Contactos del portal: memberships con role='customer' para esta cuenta
    supabase
      .from("memberships")
      .select("id, is_active, user_id, profiles(full_name)")
      .eq("account_id", id)
      .eq("role", "customer")
      .order("created_at"),
  ]);
  if (!account) notFound();

  const { data: invitations } = await supabase
    .from("portal_invitations")
    .select("id, email, accepted_at, expires_at, created_at")
    .eq("account_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  const tenant = t![0];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{account.name}</h1>
      <Notice error={errorMsg} info={okMsg} />

      <Card>
        <AccountForm action={updateAccount} country={tenant.country} account={account} submitLabel="Guardar cambios" />
      </Card>

      {/* Sección Portal de seguimiento */}
      <Card>
        <h2 className="mb-4 font-semibold">Portal de seguimiento</h2>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          Los contactos del portal pueden iniciar sesión para ver los embarques de esta cuenta y descargar documentos.
        </p>

        {/* Lista de contactos con acceso */}
        {(portalMembers ?? []).length > 0 && (
          <div className="mb-4">
            <Table cols={["Nombre", "Estado", ""]}>
              {(portalMembers ?? []).map((m) => (
                <Tr key={m.id}>
                  <Td className="text-sm">{(m.profiles as { full_name?: string } | null)?.full_name ?? m.user_id}</Td>
                  <Td>
                    <Badge color={m.is_active ? "success" : "default"}>
                      {m.is_active ? "Activo" : "Revocado"}
                    </Badge>
                  </Td>
                  <Td>
                    {m.is_active && (
                      <form action={revokePortalAccess}>
                        <input type="hidden" name="membership_id" value={m.id} />
                        <Button type="submit" variant="danger">Revocar</Button>
                      </form>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>
        )}

        {/* Invitaciones pendientes */}
        {(invitations ?? []).some((inv) => !inv.accepted_at && new Date(inv.expires_at) > new Date()) && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium uppercase text-[var(--color-text-muted)]">Invitaciones pendientes</p>
            <ul className="space-y-1">
              {(invitations ?? [])
                .filter((inv) => !inv.accepted_at && new Date(inv.expires_at) > new Date())
                .map((inv) => (
                  <li key={inv.id} className="flex items-center gap-2 text-sm">
                    <Badge color="info">Pendiente</Badge>
                    <span>{inv.email}</span>
                    <span className="text-[var(--color-text-muted)]">· vence {new Date(inv.expires_at).toLocaleDateString("es-DO")}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* Formulario de invitación */}
        <form action={inviteCustomerToPortal} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="account_id" value={id} />
          <div className="flex-1">
            <Field label="Invitar por correo" name="email" type="email" placeholder="contacto@empresa.com" />
          </div>
          <Button type="submit">Enviar invitación</Button>
        </form>
      </Card>

      <form action={deleteAccount} className="text-right">
        <input type="hidden" name="id" value={account.id} />
        <Button variant="danger">Eliminar</Button>
      </form>
    </div>
  );
}
