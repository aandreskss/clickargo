import Link from "next/link";
import { Badge, Card, EmptyState, Notice, Table, Td, Tr } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { calcStay } from "@/lib/storage-math";

type StayRow = {
  id: string;
  shipment_id: string;
  in_date: string;
  free_days: number;
  sell_rate_per_day: number;
  currency: string;
  location_note: string | null;
  provider: { name: string } | null;
  shipment: { number: string; account_id: string } | null;
  cost?: { cost_rate_per_day: number } | null;
};

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("es-DO", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtMoney(n: number, cur = "USD") {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency: cur }).format(n);
}

export default async function AlmacenajePage({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { slug }     = await params;
  const { ok, error } = await searchParams;
  const okMsg        = decode(ok);
  const errorMsg     = decode(error);

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from("memberships")
    .select("can_see_costs")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user!.id)
    .maybeSingle();
  const canSeeCosts = membership?.can_see_costs === true;

  // Siempre incluir cost join — RLS lo filtra para quienes no tienen can_see_costs
  const { data: rawStays } = await supabase
    .from("storage_stays")
    .select("id, shipment_id, in_date, free_days, sell_rate_per_day, currency, location_note, provider:accounts!provider_account_id(name), shipment:shipments(number, account_id), cost:storage_stay_costs(cost_rate_per_day)")
    .eq("status", "stored")
    .order("in_date", { ascending: true })
    .limit(200);

  // Cargar nombres de clientes en batch
  const stays = (rawStays ?? []) as unknown as StayRow[];

  const accountIds = [...new Set(
    stays.map((s) => s.shipment?.account_id).filter(Boolean) as string[]
  )];
  const { data: accounts } = accountIds.length > 0
    ? await supabase.from("accounts").select("id, name").in("id", accountIds)
    : { data: [] as { id: string; name: string }[] };
  const accName = (aid: string | null | undefined) =>
    accounts?.find((a) => a.id === aid)?.name ?? "—";

  // Calcular y ordenar por días libres restantes (más urgentes primero)
  const enriched = stays.map((s) => {
    const calc = calcStay(new Date(s.in_date + "T00:00:00"), null, s.free_days, s.sell_rate_per_day);
    return { ...s, calc };
  }).sort((a, b) => a.calc.freeDaysRemaining - b.calc.freeDaysRemaining);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Almacenaje activo</h1>
        <span className="text-sm text-[var(--color-text-muted)]">
          {enriched.length} estadía{enriched.length !== 1 ? "s" : ""} abiertas
        </span>
      </div>

      {okMsg    && <Notice info={okMsg} />}
      {errorMsg && <Notice error={errorMsg} />}

      {enriched.length === 0 ? (
        <EmptyState
          title="Sin almacenajes activos"
          description="Cuando un embarque ingrese a una bodega, aparecerá aquí."
        />
      ) : (
        <Card>
          <Table
            cols={[
              "Embarque", "Cliente", "Proveedor / Bodega",
              "Entrada", "Días libres restantes", "Cargo acumulado",
              ...(canSeeCosts ? ["Costo acumulado"] : []),
            ]}
          >
            {enriched.map((s) => {
              const remaining = s.calc.freeDaysRemaining;
              const urgent    = remaining <= 2;
              return (
                <Tr key={s.id}>
                  <Td>
                    <Link
                      href={`/embarques/${s.shipment_id}?tab=almacenaje`}
                      className="font-medium text-[var(--color-primary)] hover:underline"
                    >
                      {s.shipment?.number ?? "—"}
                    </Link>
                  </Td>
                  <Td>{accName(s.shipment?.account_id)}</Td>
                  <Td>{s.provider?.name ?? "—"}{s.location_note ? ` — ${s.location_note}` : ""}</Td>
                  <Td>{fmtDate(s.in_date)}</Td>
                  <Td>
                    <span className={urgent ? "font-semibold text-[var(--color-danger)]" : ""}>
                      {remaining > 0
                        ? `${remaining} día${remaining !== 1 ? "s" : ""}`
                        : remaining === 0
                        ? "Vence hoy"
                        : `Vencido (${Math.abs(remaining)} día${Math.abs(remaining) !== 1 ? "s" : ""})`
                      }
                    </span>
                  </Td>
                  <Td>{fmtMoney(s.calc.sellTotal, s.currency)}</Td>
                  {canSeeCosts && (
                    <Td>
                      {s.cost?.cost_rate_per_day != null
                        ? fmtMoney(Math.round(s.cost.cost_rate_per_day * s.calc.billableDays * 100) / 100, s.currency)
                        : "—"}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </Table>
        </Card>
      )}
    </div>
  );
}
