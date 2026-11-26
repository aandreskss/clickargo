import { signIn } from "@/app/actions/auth";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const errorMsg = decode(error);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-bold">Administración</h1>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">Acceso solo para superadmin.</p>
        <form action={signIn} className="space-y-4">
          <input type="hidden" name="from" value="/admin" />
          <Notice error={errorMsg} />
          <Field label="Correo" name="email" type="email" />
          <Field label="Contraseña" name="password" type="password" />
          <Button>Entrar</Button>
        </form>
      </Card>
    </main>
  );
}
