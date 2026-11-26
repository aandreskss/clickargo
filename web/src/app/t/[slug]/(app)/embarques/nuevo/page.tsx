import { notFound } from "next/navigation";
import { Button, Card, Field, Notice, Select, Stepper } from "@/components/ui";
import { SHIPMENT_MODES, SHIPMENT_DIRECTIONS } from "@/lib/field-packs";
import { decode } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { createShipmentStep1 } from "@/app/actions/shipments";

const STEPS = [
  { label: "Cliente y modo" },
  { label: "Ruta y carga" },
  { label: "Fechas y referencias" },
];

export default async function NuevoEmbarquePaso1({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from_quote?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { from_quote, error } = await searchParams;
  const errorMsg = decode(error);
  const supabase = await createClient();

  const { data: t } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  const tenant = t![0];

  // Cargar cuentas para el selector de cliente
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, kind")
    .eq("tenant_id", tenant.id)
    .order("name");

  // Si viene de una cotización, pre-cargar datos
  let prefill: { account_id: string; mode: string; direction: string } | null = null;
  if (from_quote) {
    const { data: q } = await supabase
      .from("quotes")
      .select("account_id, service_type")
      .eq("id", from_quote)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (q) {
      const modeMap: Record<string, { mode: string; direction: string }> = {
        mar_import:  { mode: "ocean", direction: "import" },
        mar_export:  { mode: "ocean", direction: "export" },
        aire_import: { mode: "air",   direction: "import" },
      };
      const derived = modeMap[q.service_type];
      if (derived) prefill = { account_id: q.account_id, ...derived };
    }
  }

  const accountOptions = (accounts ?? []).map((a) => ({
    value: a.id,
    label: a.name,
  }));

  return (
    <div className="space-y-6">
      <Stepper steps={STEPS} current={0} />

      <Notice error={errorMsg} />

      <form action={createShipmentStep1} className="space-y-4">
        {from_quote && <input type="hidden" name="quote_id" value={from_quote} />}

        <Card>
          <h2 className="mb-4 font-semibold text-[var(--color-text)]">Cliente y tipo de embarque</h2>
          <div className="space-y-4">
            <Select
              name="account_id"
              label="Cliente"
              options={accountOptions}
              defaultValue={prefill?.account_id ?? ""}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                name="mode"
                label="Modo de transporte"
                options={[...SHIPMENT_MODES]}
                defaultValue={prefill?.mode ?? "ocean"}
                required
              />
              <Select
                name="direction"
                label="Dirección"
                options={[...SHIPMENT_DIRECTIONS]}
                defaultValue={prefill?.direction ?? "import"}
                required
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <a href="/embarques"><Button type="button" variant="ghost">Cancelar</Button></a>
          <Button type="submit">Siguiente →</Button>
        </div>
      </form>
    </div>
  );
}