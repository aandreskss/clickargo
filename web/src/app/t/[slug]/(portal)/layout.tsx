import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/portal-login");

  const tenant = await tenantFromHost();
  if (!tenant) redirect("/portal-login");

  // Verificar que el usuario es customer activo de este tenant
  const { data: m } = await supabase
    .from("memberships")
    .select("role, is_active, account_id, accounts(name)")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .eq("role", "customer")
    .maybeSingle();

  if (!m || !m.is_active) {
    await supabase.auth.signOut();
    redirect("/portal-login");
  }

  const accountName = (m.accounts as { name?: string } | null)?.name ?? "";

  return (
    <div className="min-h-screen bg-[var(--color-surface-subtle)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[var(--color-text)]">{tenant.name}</span>
            <span className="hidden text-sm text-[var(--color-text-muted)] sm:inline">· {accountName}</span>
          </div>
          <form action={signOut}>
            <input type="hidden" name="to" value="/portal-login" />
            <Button variant="ghost">Cerrar sesión</Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
