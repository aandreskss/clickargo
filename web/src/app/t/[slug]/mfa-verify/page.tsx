import { verifyTotp } from "@/app/actions/mfa";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function MfaVerify({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; factorId?: string }>;
}) {
  const { slug } = await params;
  const base = `/t/${slug}`;
  const { error, factorId: paramFactorId } = await searchParams;
  const errorMsg = decode(error);
  const supabase = await createClient();

  // Obtener el factor TOTP enrollado del usuario.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totpFactor = factors?.totp?.[0];
  const factorId = paramFactorId ?? totpFactor?.id ?? "";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-bold">Verificación en dos pasos</h1>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">
          Ingresa el código de tu app de autenticación para continuar.
        </p>
        <form action={verifyTotp} className="space-y-4">
          <Notice error={errorMsg} />
          <input type="hidden" name="factorId" value={factorId} />
          <input type="hidden" name="base" value={base} />
          <Field label="Código de 6 dígitos" name="code" placeholder="123456" inputMode="numeric" pattern="[0-9 ]{6,8}" />
          <Button>Verificar</Button>
        </form>
      </Card>
    </main>
  );
}
