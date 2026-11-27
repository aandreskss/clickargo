import { signUp } from "@/app/actions/auth";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";

export default async function Registro({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-bold">Crear cuenta</h1>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">Usa el correo al que llegó tu invitación.</p>
        <form action={signUp} className="space-y-4">
          <Notice error={errorMsg} />
          <input type="hidden" name="base" value={`/t/${slug}`} />
          <Field label="Nombre completo" name="full_name" />
          <Field label="Correo" name="email" type="email" />
          <Field label="Contraseña" name="password" type="password" minLength={12} hint="Mínimo 12 caracteres." />
          <Button>Crear cuenta</Button>
        </form>
        <p className="mt-5 text-sm text-[var(--color-text-muted)]">¿Ya tienes cuenta? <a href={`/t/${slug}/login`} className="font-medium text-[var(--color-text-link)] hover:underline">Inicia sesión</a></p>
      </Card>
    </main>
  );
}
