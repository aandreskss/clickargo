import Link from "next/link";
import { Badge, Card, EmptyState, Table, Td, Tr } from "@/components/ui";
import { STAGE_LABELS, STAGE_BADGE_COLORS } from "@/lib/field-packs";
import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";

export default async function PortalHome() {
  const supabase = await createClient();
  const tenant   = await tenantFromHost();
  if (!tenant) return null;

  // RLS filtra automáticamente: solo los embarques de la cuenta del cliente
  const { data: shipments } = await supabase
    .from("shipments")
    .select("id, number, stage_key, mode, origin_port_id, destination_port_id, eta")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = shipments ?? [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-[var(--color-text)]">Mis embarques</h1>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Sin embarques"
            description="Cuando tu agente registre un embarque para tu empresa aparecerá aquí."
          />
        </Card>
      ) : (
        <Card>
          <Table cols={["Número", "Ruta", "Modo", "Etapa", "ETA", ""]}>
            {rows.map((s) => (
              <Tr key={s.id}>
                <Td className="font-mono font-medium">{s.number}</Td>
                <Td className="text-sm text-[var(--color-text-muted)]">
                  {s.origin_port_id} → {s.destination_port_id}
                </Td>
                <Td className="text-sm capitalize">{s.mode?.replace("_", " ")}</Td>
                <Td>
                  <Badge color={STAGE_BADGE_COLORS[s.stage_key] ?? "default"}>
                    {STAGE_LABELS[s.stage_key] ?? s.stage_key}
                  </Badge>
                </Td>
                <Td className="text-sm">{s.eta ?? "—"}</Td>
                <Td>
                  <Link
                    href={`/portal/embarques/${s.id}`}
                    className="text-sm font-medium text-[var(--color-text-link)] hover:underline"
                  >
                    Ver
                  </Link>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
