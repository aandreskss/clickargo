import { enrollTotp, verifyTotp } from "@/app/actions/mfa";
import { Button, Card, Field, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function MfaSetup({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; uri?: string; factorId?: string }>;
}) {
  const { slug } = await params;
  const { error, uri, factorId } = await searchParams;
  const errorMsg = decode(error);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Si ya hay un uri, mostramos el QR para que el usuario escanee y verifique.
  if (uri && factorId) {
    const totpUri = decodeURIComponent(uri);
    // Usamos una URL de Google Charts para renderizar el QR (sin instalar librerías).
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`;
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
        <Card>
          <h1 className="mb-1 text-xl font-bold">Verificación en dos pasos</h1>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">
            Escanea este código QR con tu app de autenticación (Google Authenticator, Authy, etc.)
            y luego ingresa el código de 6 dígitos.
          </p>
          <Notice error={errorMsg} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="Código QR para autenticación TOTP" className="mx-auto mb-4 rounded" width={200} height={200} />
          <form action={verifyTotp} className="space-y-4">
            <input type="hidden" name="factorId" value={factorId} />
            <Field label="Código de 6 dígitos" name="code" placeholder="123456" inputMode="numeric" pattern="[0-9 ]{6,8}" />
            <Button>Verificar y activar</Button>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <Card>
        <h1 className="mb-1 text-xl font-bold">Activar verificación en dos pasos</h1>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">
          Tu rol requiere verificación en dos pasos (MFA). Configúrala ahora para continuar.
        </p>
        <Notice error={errorMsg} />
        <form action={enrollTotp} className="space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <Field label="Nombre del dispositivo" name="friendly_name" defaultValue="Mi teléfono" />
          <Button>Continuar</Button>
        </form>
        <p className="mt-4 text-xs text-[var(--color-text-muted)]">
          Cuenta: {user?.email}
        </p>
      </Card>
    </main>
  );
}
