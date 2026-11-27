import { acceptPortalInvitation } from "@/app/actions/portal";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";

export default async function PortalAccept({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; error?: string }>;
}) {
  const { t: token, error } = await searchParams;
  const errorMsg = decode(error);

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
        <Card>
          <Notice error={decode("invitacion_invalida")} />
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-bold">Crear contraseña</h1>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">
          Crea una contraseña segura para acceder al portal de seguimiento.
        </p>
        <form action={acceptPortalInvitation} className="space-y-4">
          <Notice error={errorMsg} />
          <input type="hidden" name="token" value={token} />
          <Field
            label="Contraseña (mínimo 12 caracteres)"
            name="password"
            type="password"
            minLength={12}
          />
          <Button>Activar acceso</Button>
        </form>
      </Card>
    </main>
  );
}
