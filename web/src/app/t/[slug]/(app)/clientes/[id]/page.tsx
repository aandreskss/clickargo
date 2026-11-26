import { notFound } from "next/navigation";
import { deleteAccount, updateAccount } from "@/app/actions/accounts";
import { AccountForm } from "@/components/account-form";
import { Button, Card, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function EditarCuenta({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { slug, id } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: t }, { data: account }] = await Promise.all([
    supabase.rpc("tenant_by_slug", { _slug: slug }),
    supabase.from("accounts").select("*").eq("id", id).maybeSingle(),
  ]);
  if (!account) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{account.name}</h1>
      <Notice error={errorMsg} />
      <Card><AccountForm action={updateAccount} country={t![0].country} account={account} submitLabel="Guardar cambios" /></Card>
      <form action={deleteAccount} className="text-right">
        <input type="hidden" name="id" value={account.id} />
        <Button variant="danger">Eliminar</Button>
      </form>
    </div>
  );
}
