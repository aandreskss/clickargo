import { signIn } from "@/app/actions/auth";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function TenantLogin({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { slug } = await params;
  const { error, ok } = await searchParams;
  const errorMsg = decode(error);
  const okMsg = decode(ok);
  const supabase = await createClient();
  const { data } = await supabase.rpc("tenant_by_slug", { _slug: slug });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-bold">{data?.[0]?.name}</h1>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">Inicia sesión para continuar.</p>
        <form action={signIn} className="space-y-4">
          <Notice error={errorMsg} info={okMsg} />
          <input type="hidden" name="base" value={`/t/${slug}`} />
          <Field label="Correo" name="email" type="email" />
          <Field label="Contraseña" name="password" type="password" />
          <Button>Entrar</Button>
        </form>
        <p className="mt-5 text-sm text-[var(--color-text-muted)]">
          ¿Te invitaron? <a href={`/t/${slug}/registro`} className="font-medium text-[var(--color-text-link)] hover:underline">Crea tu cuenta</a> con el mismo correo de la invitación.
        </p>
      </Card>
    </main>
  );
}
