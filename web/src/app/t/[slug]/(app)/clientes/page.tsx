import { Button, Card, EmptyState, Field, Notice, Table, Tabs, Td, Tr } from "@/components/ui";
import { ACCOUNT_KINDS, kindLabel } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const PAGE = 50;

export default async function Clientes({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; tipo?: string; ok?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { q = "", tipo = "", ok, error } = await searchParams;
  const errorMsg = decode(error);
  const okMsg = decode(ok);
  const supabase = await createClient();

  // Obtener el tenant para pasárselo al RPC.
  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  // Sanitizar el término de búsqueda: eliminar caracteres que no aportan a la búsqueda de texto.
  const term = q.replace(/[%_]/g, " ").trim();

  const { data: rows } = await supabase.rpc("search_accounts", {
    _tenant: tenant.id,
    _q:      term,
    _kind:   tipo,
    _limit:  PAGE,
  });

  const tabs = [
    { value: "", label: "Todos", href: `/clientes${q ? `?q=${encodeURIComponent(q)}` : ""}` },
    ...ACCOUNT_KINDS.map((k) => ({
      value: k.value,
      label: k.plural,
      href: `/clientes?${new URLSearchParams({ ...(q && { q }), tipo: k.value })}`,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Clientes y contactos</h1>
        <a href="/clientes/nuevo">
          <Button type="button">+ Nuevo</Button>
        </a>
      </div>

      <Notice error={errorMsg} info={okMsg} />

      <form className="flex gap-2" action="/clientes">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <Field name="q" label="" defaultValue={q} placeholder="Buscar por nombre, RNC, correo o teléfono…" required={false} />
        <Button>Buscar</Button>
      </form>

      <Tabs tabs={tabs} active={tipo} />

      <Card className="p-0">
        {rows?.length ? (
          <Table cols={["Nombre", "Tipo", "ID fiscal", "Correo", "Teléfono"]}>
            {rows.map((r: { id: string; kind: string; name: string; tax_id: string | null; email: string | null; phone: string | null }) => (
              <Tr key={r.id} href={`/clientes/${r.id}`}>
                <Td><a href={`/clientes/${r.id}`} className="font-medium text-[var(--color-text-link)] hover:underline">{r.name}</a></Td>
                <Td>{kindLabel(r.kind)}</Td>
                <Td className="hidden sm:table-cell text-[var(--color-text-muted)]">{r.tax_id ?? "—"}</Td>
                <Td className="hidden md:table-cell text-[var(--color-text-muted)]">{r.email ?? "—"}</Td>
                <Td className="hidden md:table-cell text-[var(--color-text-muted)]">{r.phone ?? "—"}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <EmptyState message={term || tipo
            ? "No encontramos resultados con ese filtro."
            : "Aún no tienes cuentas. Crea la primera con \"+ Nuevo\"."
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
