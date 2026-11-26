import Link from "next/link";
import { Button, Card, EmptyState, Field, Notice, Table, Tabs, Td, Tr, Badge } from "@/components/ui";
import { QUOTE_STATUSES, serviceTypeLabel, statusConfig } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { fmtMoney } from "@/lib/quote-math";

const PAGE = 50;

export default async function Cotizaciones({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; status?: string; ok?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { q = "", status = "", ok, error } = await searchParams;
  const errorMsg = decode(error);
  const okMsg = decode(ok);
  const supabase = await createClient();

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const term = q.replace(/[%_]/g, " ").trim();

  const { data: rows } = await supabase.rpc("search_quotes", {
    _tenant: tenant.id,
    _q:      term,
    _status: status,
    _limit:  PAGE,
  });

  const tabs = [
    { value: "",         label: "Todas",      href: `/cotizaciones${q ? `?q=${encodeURIComponent(q)}` : ""}` },
    ...QUOTE_STATUSES.map((s) => ({
      value: s.value,
      label: s.label,
      href:  `/cotizaciones?${new URLSearchParams({ ...(q && { q }), status: s.value })}`,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Cotizaciones</h1>
        <Link href="/cotizaciones/nueva">
          <Button type="button">+ Nueva</Button>
        </Link>
      </div>

      <Notice error={errorMsg} info={okMsg} />

      <form className="flex gap-2" action="/cotizaciones">
        {status && <input type="hidden" name="status" value={status} />}
        <Field name="q" label="" defaultValue={q} placeholder="Buscar por número o cliente…" required={false} />
        <Button>Buscar</Button>
      </form>

      <Tabs tabs={tabs} active={status} />

      <Card className="p-0">
        {rows?.length ? (
          <Table cols={["Número", "Cliente", "Servicio", "Total", "Estado", "Vence"]}>
            {rows.map((r: {
              id: string;
              number: string;
              account_name: string | null;
              service_type: string;
              currency: string;
              total_sale: number;
              status: string;
              valid_until: string | null;
            }) => {
              const sc = statusConfig(r.status);
              return (
                <Tr key={r.id} href={`/cotizaciones/${r.id}`}>
                  <Td>
                    <a href={`/cotizaciones/${r.id}`} className="font-medium text-[var(--color-text-link)] hover:underline">
                      {r.number}
                    </a>
                  </Td>
                  <Td>{r.account_name ?? "—"}</Td>
                  <Td className="hidden sm:table-cell text-[var(--color-text-muted)]">
                    {serviceTypeLabel(r.service_type)}
                  </Td>
                  <Td>{fmtMoney(r.total_sale, r.currency)}</Td>
                  <Td>
                    <Badge color={sc.color}>{sc.label}</Badge>
                  </Td>
                  <Td className="hidden md:table-cell text-[var(--color-text-muted)]">
                    {r.valid_until ?? "—"}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState message={term || status
            ? "No encontramos cotizaciones con ese filtro."
            : "Aún no tienes cotizaciones. Crea la primera con \"+ Nueva\"."
          } />
        )}
      </Card>

      {rows && rows.length >= PAGE && (
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Mostrando los primeros {PAGE} resultados. Afina la búsqueda para ver el resto.
        </p>
      )}
    </div>
  );
}
