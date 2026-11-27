import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const ROLES: Record<string, string> = {
  owner: "Dueño", admin: "Administrador", manager: "Gerente", operator: "Operador",
  finance: "Finanzas", sales: "Ventas", customs_broker: "Agente aduanal", viewer: "Solo lectura",
};

const MFA_ROLES = new Set(["owner", "admin"]);

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Falla cerrado: si el proxy no bloqueó la sesión expirada, lo hacemos aquí.
  if (!user) redirect("/login");

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  // Empresa suspendida: solo lectura visual, sin acceso a escrituras.
  if (tenant.status === "suspended") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <Card>
          <h1 className="mb-2 text-lg font-bold">Empresa suspendida</h1>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">
            La cuenta de {tenant.name} está suspendida. Contacta a soporte para reactivarla.
          </p>
          <form action={signOut}><Button variant="ghost">Cerrar sesión</Button></form>
        </Card>
      </main>
    );
  }

  // La RLS solo devuelve la membresía si el usuario pertenece a ESTA empresa.
  const { data: m } = await supabase
    .from("memberships").select("role").eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();

  if (!m) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <Card>
          <h1 className="mb-2 text-lg font-bold">Sin acceso a {tenant.name}</h1>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">
            Tu cuenta ({user.email}) no tiene acceso a esta empresa. Pide al administrador que te invite con este correo.
          </p>
          <form action={signOut}><Button variant="ghost">Cerrar sesión</Button></form>
        </Card>
      </main>
    );
  }

  // Roles con MFA obligatoria: verificar AAL2 antes de dar acceso.
  if (MFA_ROLES.has(m.role)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      redirect(aal?.nextLevel === "aal2" ? "/mfa-verify" : "/mfa-setup");
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface-subtle)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-5">
            <Link href="/" className="font-bold text-[var(--color-text)]">{tenant.name}</Link>
            <nav className="flex gap-4 text-sm font-medium text-[var(--color-text-muted)]">
              <Link href="/" className="hover:text-[var(--color-text)]">Inicio</Link>
              <Link href="/clientes" className="hover:text-[var(--color-text)]">Clientes</Link>
              <Link href="/cotizaciones" className="hover:text-[var(--color-text)]">Cotizaciones</Link>
              <Link href="/embarques" className="hover:text-[var(--color-text)]">Embarques</Link>
              <Link href="/masters" className="hover:text-[var(--color-text)]">Masters</Link>
              <Link href="/almacenaje" className="hover:text-[var(--color-text)]">Almacenaje</Link>
              {(m.role === "owner" || m.role === "admin") && (
                <Link href="/ajustes/empresa" className="hover:text-[var(--color-text)]">Ajustes</Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
            <span className="hidden sm:inline">{user.email} · {ROLES[m.role]}</span>
            <form action={signOut}><Button variant="ghost">Salir</Button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
