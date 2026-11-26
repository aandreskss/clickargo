import { Card, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { QuoteForm } from "@/components/quote-form";
import { createQuote } from "@/app/actions/quotes";

export default async function NuevaCotizacion({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);
  const supabase = await createClient();

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: accounts }, { data: membership }] = await Promise.all([
    supabase.rpc("search_accounts", {
      _tenant: tenant.id,
      _q:      "",
      _kind:   "customer",
      _limit:  200,
    }),
    user
      ? supabase.from("memberships").select("can_see_costs")
          .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const canSeeCosts = membership?.can_see_costs === true;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold text-[var(--color-text)]">Nueva cotización</h1>
      <Notice error={errorMsg} />
      <Card>
        <QuoteForm
          action={createQuote}
          accounts={(accounts ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))}
          canSeeCosts={canSeeCosts}
        />
      </Card>
    </div>
  );
}
