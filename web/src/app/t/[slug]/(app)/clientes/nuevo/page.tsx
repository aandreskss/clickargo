import { createAccount } from "@/app/actions/accounts";
import { AccountForm } from "@/components/account-form";
import { Card, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaCuenta({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);
  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Nueva cuenta</h1>
      <Notice error={errorMsg} />
      <Card><AccountForm action={createAccount} country={t![0].country} submitLabel="Guardar" /></Card>
    </div>
  );
}
