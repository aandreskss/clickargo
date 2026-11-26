import { createTenant } from "@/app/actions/admin";
import { signOut } from "@/app/actions/auth";
import { Button, Card, EmptyState, Field, Notice, Select, Table, Td, Tr } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const COUNTRIES = [
  { value: "DO", label: "República Dominicana" },
  { value: "US", label: "Estados Unidos" },
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const errorMsg = decode(error);
  const okMsg = decode(ok);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("is_superadmin, full_name").eq("id", user!.id).single();

  if (!profile?.is_superadmin) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <Card>
          <h1 className="mb-2 text-lg font-bold">Sin permiso</h1>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">Tu cuenta ({user!.email}) no es superadmin.</p>
          <form action={signOut}><input type="hidden" name="to" value="/admin/login" /><Button variant="ghost">Cerrar sesión</Button></form>
        </Card>
      </main>
    );
  }

  const { data: tenants } = await supabase
    .from("tenants").select("id, slug, name, country, plan, status, created_at").order("created_at", { ascending: false });
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Empresas</h1>
        <form action={signOut}><input type="hidden" name="to" value="/admin/login" /><Button variant="ghost">Cerrar sesión</Button></form>
      </header>

      <Notice error={errorMsg} info={okMsg} />

      <Card>
        <h2 className="mb-4 font-semibold text-[var(--color-text)]">Nueva empresa</h2>
        <form action={createTenant} className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" name="name" placeholder="Mi Empresa" />
          <Field label="Subdominio" name="slug" placeholder="miempresa" hint={`Quedará en <subdominio>.${root}`} />
          <Select label="País" name="country" options={COUNTRIES} />
          <Field label="Correo del dueño" name="owner_email" type="email" placeholder="dueno@empresa.com" />
          <div className="sm:col-span-2"><Button>Crear empresa</Button></div>
        </form>
      </Card>

      <Card className="p-0">
        {tenants?.length ? (
          <Table cols={["Empresa", "Subdominio", "País", "Plan", "Estado"]}>
            {tenants.map((t) => (
              <Tr key={t.id}>
                <Td><span className="font-medium">{t.name}</span></Td>
                <Td className="text-[var(--color-text-muted)]">{t.slug}</Td>
                <Td>{t.country}</Td>
                <Td>{t.plan}</Td>
                <Td>{t.status}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <EmptyState message="Aún no hay empresas. Crea la primera arriba." />
        )}
      </Card>
    </main>
  );
}
