import { loginPortal } from "@/app/actions/portal";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function PortalLogin({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { slug } = await params;
  const { error, ok } = await searchParams;
  const errorMsg = decode(error);
  const okMsg    = decode(ok);

  const supabase = await createClient();
  const { data }  = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant    = data?.[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-bold">{tenant?.name ?? "Portal"}</h1>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">
          Accede al portal de seguimiento de tus embarques.
        </p>
        <form action={loginPortal} className="space-y-4">
          <Notice error={errorMsg} info={okMsg} />
          <Field label="Correo" name="email" type="email" />
          <Field label="Contraseña" name="password" type="password" />
          <Button>Entrar al portal</Button>
        </form>
      </Card>
    </main>
  );
}
