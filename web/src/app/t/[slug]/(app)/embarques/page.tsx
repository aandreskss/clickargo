import Link from "next/link";
import { Button, Card, EmptyState, Field, Notice, Table, Tabs, Td, Tr, Badge } from "@/components/ui";
import { STAGE_LABELS, STAGE_BADGE_COLORS, SHIPMENT_MODES } from "@/lib/field-packs";
import { TERMINAL_STAGES } from "@/lib/stage-rules";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const PAGE = 50;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

const STAGE_TABS = [
  "booked", "picked_up", "at_origin", "in_transit",
  "at_destination", "out_for_delivery", "delivered",
];

export default async function Embarques({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; stage?: string; ok?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { q = "", stage = "", ok, error } = await searchParams;
  const errorMsg = decode(error);
  const okMsg = decode(ok);
  const supabase = await createClient();

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  const term = q.replace(/[%_]/g, " ").trim();

  const { data: rows } = await supabase.rpc("search_shipments", {
    _tenant: tenant.id,
    _q:      term,
    _stage:  stage,
    _limit:  PAGE,
  });

  const today = new Date().toISOString().split("T")[0];
  const threeDaysFromNow = new Date(Date.now() + THREE_DAYS_MS).toISOString().split("T")[0];

  const tabs = [
    { value: "", label: "Todos", href: `/embarques${q ? `?q=${encodeURIComponent(q)}` : ""}` },
    ...STAGE_TABS.map((s) => ({
      value: s,
      label: STAGE_LABELS[s] ?? s,
      href: `/embarques?${new URLSearchParams({ ...(q && { q }), stage: s })}`,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Embarques</h1>
        <Link href="/embarques/nuevo">
          <Button type="button">+ Nuevo</Button>
        </Link>
      </div>

      <Notice error={errorMsg} info={okMsg} />

      <form className="flex flex-wrap gap-2" action="/embarques">
        {stage && <input type="hidden" name="stage" value={stage} />}
        <Field name="q" label="" defaultValue={q} placeholder="Número, BL, booking, cliente…" required={false} />
        <Button>Buscar</Button>
      </form>

      <Tabs tabs={tabs} active={stage} />

      <Card className="p-0">
        {rows?.length ? (
          <Table cols={["Número", "Cliente", "Ruta", "Modo", "Etapa", "ETA"]}>
            {(rows as Array<{
              id: string; number: string; account_name: string | null;
              mode: string; direction: string; stage_key: string;
              origin_port_id: string | null; destination_port_id: string | null;
              eta: string | null; updated_at: string;
            }>).map((r) => {
              const isTerminal = TERMINAL_STAGES.has(r.stage_key as never);
              const isStopped = !isTerminal && (Date.now() - new Date(r.updated_at).getTime()) > THREE_DAYS_MS;
              const etaOverdue = r.eta && r.eta < today && !isTerminal;
              const etaSoon = r.eta && r.eta >= today && r.eta <= threeDaysFromNow && !isTerminal;
              const route = [r.origin_port_id, r.destination_port_id].filter(Boolean).join(" → ");
              const modeLabel = SHIPMENT_MODES.find((m) => m.value === r.mode)?.label ?? r.mode;

              return (
                <Tr key={r.id} href={`/embarques/${r.id}`}>
                  <Td>
                    <a href={`/embarques/${r.id}`} className="font-medium text-[var(--color-text-link)] hover:underline">
                      {r.number}
                    </a>
                  </Td>
                  <Td>{r.account_name ?? "—"}</Td>
                  <Td className="hidden sm:table-cell text-[var(--color-text-muted)] text-sm">{route || "—"}</Td>
                  <Td className="hidden md:table-cell text-[var(--color-text-muted)] text-sm">{modeLabel}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge color={STAGE_BADGE_COLORS[r.stage_key] ?? "default"}>
                        {STAGE_LABELS[r.stage_key] ?? r.stage_key}
                      </Badge>
                      {isStopped && <Badge color="danger">Detenido</Badge>}
                    </div>
                  </Td>
                  <Td>
                    {r.eta ? (
                      <span className={
                        etaOverdue ? "font-medium text-[var(--color-error)]" :
                        etaSoon    ? "font-medium text-[var(--color-warning)]" :
                        "text-[var(--color-text-muted)]"
                      }>
                        {etaOverdue ? "Vencida " : ""}{r.eta}
                      </span>
                    ) : "—"}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState
            message={term || stage
              ? "No encontramos embarques con ese filtro."
              : "Aún no tienes embarques. Crea uno con \"+ Nuevo\" o convierte una cotización."
            }
          />
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