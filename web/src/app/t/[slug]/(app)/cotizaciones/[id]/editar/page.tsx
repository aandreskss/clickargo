import { notFound } from "next/navigation";
import { Card, Notice } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { QuoteForm } from "@/components/quote-form";
import { updateQuote } from "@/app/actions/quotes";

export default async function EditarCotizacion({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, id } = await params;
  const { error } = await searchParams;
  const errorMsg = decode(error);

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: { user } } = await supabase.auth.getUser();

  const [
    { data: quote },
    { data: lines },
    { data: membership },
  ] = await Promise.all([
    supabase.from("quotes")
      .select("id, number, status, service_type, origin, destination, currency, notes, valid_until, account_id")
      .eq("id", id).maybeSingle(),
    supabase.from("quote_lines")
      .select("id, service, qty, unit_price, currency, taxable, sort_order")
      .eq("quote_id", id).order("sort_order"),
    user
      ? supabase.from("memberships").select("can_see_costs")
          .eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!quote) notFound();
  if (quote.status !== "draft") notFound();

  const canSeeCosts = membership?.can_see_costs === true;

  const [{ data: accounts }, { data: costs }] = await Promise.all([
    supabase.rpc("search_accounts", {
      _tenant: tenant.id,
      _q:      "",
      _kind:   "customer",
      _limit:  200,
    }),
    canSeeCosts && lines?.length
      ? supabase.from("quote_line_costs")
          .select("quote_line_id, cost, currency")
          .in("quote_line_id", lines.map((l) => l.id))
      : Promise.resolve({ data: null }),
  ]);

  // Reconstruct default lines for the form
  const defaultLines = (lines ?? []).map((l, i) => {
    const lineCost = costs?.find((c) => c.quote_line_id === l.id);
    return {
      key:        `existing-${i}`,
      service:    l.service,
      qty:        String(l.qty),
      unit_price: String(l.unit_price),
      taxable:    l.taxable,
      cost:       lineCost ? String(lineCost.cost) : "",
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold text-[var(--color-text)]">
        Editar {quote.number}
      </h1>
      <Notice error={errorMsg} />
      <Card>
        <QuoteForm
          action={updateQuote}
          accounts={(accounts ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))}
          canSeeCosts={canSeeCosts}
          defaultAccountId={quote.account_id}
          defaultServiceType={quote.service_type}
          defaultOrigin={quote.origin ?? ""}
          defaultDestination={quote.destination ?? ""}
          defaultCurrency={quote.currency}
          defaultNotes={quote.notes ?? ""}
          defaultValidUntil={quote.valid_until ?? ""}
          defaultLines={defaultLines}
          quoteId={id}
          submitLabel="Guardar cambios"
        />
      </Card>
    </div>
  );
}
