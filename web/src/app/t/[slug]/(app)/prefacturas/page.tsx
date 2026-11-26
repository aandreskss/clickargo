import Link from "next/link";
import { Badge, Card, EmptyState, Notice, Table, Td, Tr } from "@/components/ui";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABELS: Record<string, string> = {
  draft:        "Borrador",
  ready:        "Lista",
  sent_to_erp:  "Enviada a ERP",
  invoiced:     "Facturada",
  void:         "Anulada",
};

const STATUS_COLORS: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  draft:       "default",
  ready:       "info",
  sent_to_erp: "warning",
  invoiced:    "success",
  void:        "danger",
};

export default async function Prefacturas({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string; status?: string }>;
}) {
  const { slug } = await params;
  const { ok, error, status = "" } = await searchParams;
  const okMsg    = decode(ok);
  const errorMsg = decode(error);

  const supabase = await createClient();
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  let query = supabase
    .from("pre_invoices")
    .select("id, number, status, currency, total, notes, created_at, account_id")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) query = query.eq("status", status);

  const { data: rows } = await query;

  // Cargar nombres de cuentas
  const accountIds = [...new Set((rows ?? []).map((r) => r.account_id).filter(Boolean))];
  const { data: accounts } = accountIds.length > 0
    ? await supabase.from("accounts").select("id, name").in("id", accountIds)
    : { data: [] as { id: string; name: string }[] };

  const accName = (aid: string) => accounts?.find((a) => a.id === aid)?.name ?? "—";

  const fmtMoney = (n: number, cur = "USD") =>
    new Intl.NumberFormat("es-DO", { style: "currency", currency: cur }).format(n);

  const statusTabs = [
    { value: "",            label: "Todas" },
    { value: "ready",       label: "Por enviar a ERP" },
    { value: "sent_to_erp", label: "Enviadas" },
    { value: "invoiced",    label: "Facturadas" },
    { value: "void",        label: "Anuladas" },
  ];

  const readyCount = (rows ?? []).filter((r) => r.status === "ready").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Prefacturas</h1>
        {readyCount > 0 && (
          <span className="rounded-full bg-[var(--color-primary)] px-3 py-1 text-sm font-semibold text-[var(--color-primary-text)]">
            {readyCount} por enviar a ERP
          </span>
        )}
      </div>

      <Notice error={errorMsg} info={okMsg} />

      {/* Filtros de estado */}
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((s) => (
          <Link
            key={s.value}
            href={`/prefacturas${s.value ? `?status=${s.value}` : ""}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              status === s.value
                ? "bg-[var(--color-primary)] text-[var(--color-primary-text)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] ring-1 ring-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {(rows ?? []).length === 0 ? (
        <Card>
          <EmptyState
            title="Sin prefacturas"
            description="Las prefacturas se crean desde la pestaña Cargos de un embarque."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <Table cols={["Número", "Cliente", "Total", "Estado", "Fecha"]}>
            {(rows ?? []).map((pi) => (
              <Tr key={pi.id} href={`/prefacturas/${pi.id}`}>
                <Td>
                  <span className="font-mono font-semibold text-[var(--color-text)]">{pi.number}</span>
                </Td>
                <Td>{accName(pi.account_id)}</Td>
                <Td>
                  <span className="font-semibold">{fmtMoney(Number(pi.total), pi.currency)}</span>
                  <span className="ml-1 text-xs text-[var(--color-text-muted)]">{pi.currency}</span>
                </Td>
                <Td>
                  <Badge color={STATUS_COLORS[pi.status] ?? "default"}>
                    {STATUS_LABELS[pi.status] ?? pi.status}
                  </Badge>
                </Td>
                <Td>
                  {new Date(pi.created_at).toLocaleDateString("es-DO", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
