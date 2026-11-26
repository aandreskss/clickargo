import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { decode } from "@/lib/messages";
import { saveCredentials } from "@/app/actions/pre-invoices";
import { PageHeader, Card, Field, Button, Notice, Tabs } from "@/components/ui";

const AJUSTES_TABS = [
  { value: "empresa",     label: "Empresa",     href: "/ajustes/empresa"     },
  { value: "numeracion",  label: "Numeración",  href: "/ajustes/numeracion"  },
  { value: "equipo",      label: "Equipo",      href: "/ajustes/equipo"      },
  { value: "cargos",      label: "Cargos",      href: "/ajustes/cargos"      },
  { value: "integracion", label: "Integración", href: "/ajustes/integracion" },
  { value: "plantillas",  label: "Plantillas",  href: "/ajustes/plantillas"  },
];

export default async function AjustesIntegracion({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  // Cargar credenciales existentes (solo campos no sensibles — NUNCA encrypted_payload)
  const { data: cred } = await supabase
    .from("integration_credentials")
    .select("id, provider, masked_display, last_accessed_at, updated_at")
    .eq("tenant_id", tenant.id)
    .eq("provider", "adm_cloud")
    .maybeSingle();

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" />
      <Tabs tabs={AJUSTES_TABS} active="integracion" />
      <Notice error={decode(error)} info={decode(ok)} />

      {/* ── ADM Cloud ── */}
      <Card>
        <h2 className="mb-1 font-semibold text-[var(--color-text)]">ADM Cloud</h2>
        <p className="mb-5 text-sm text-[var(--color-text-muted)]">
          Credenciales para enviar prefacturas automáticamente a ADM Cloud (sistema de facturación
          de Box To Go). La clave se guarda cifrada y nunca se muestra completa.
        </p>

        {cred && (
          <div className="mb-5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm">
            <p className="text-[var(--color-text-muted)]">Credencial actual</p>
            <p className="mt-1 font-mono font-semibold text-[var(--color-text)]">{cred.masked_display}</p>
            {cred.updated_at && (
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Actualizada el{" "}
                {new Date(cred.updated_at).toLocaleDateString("es-DO", {
                  day: "2-digit", month: "short", year: "numeric",
                })}
              </p>
            )}
          </div>
        )}

        <form action={saveCredentials} className="space-y-4">
          <input type="hidden" name="provider" value="adm_cloud" />

          <Field
            name="api_key"
            label={cred ? "Nueva clave API (reemplaza la actual)" : "Clave API"}
            required
            type="password"
            placeholder="Pega aquí la clave API de ADM Cloud"
          />
          <Field
            name="base_url"
            label="URL base del API (opcional)"
            placeholder="https://api.admcloud.com/v1"
          />

          <div className="pt-1">
            <Button type="submit">{cred ? "Actualizar credencial" : "Guardar credencial"}</Button>
          </div>
        </form>

        <div className="mt-6 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          <strong className="text-[var(--color-text)]">Nota operativa:</strong> La integración
          automática con ADM Cloud está en desarrollo. Por ahora, usa{" "}
          <strong>Descargar CSV</strong> o <strong>Descargar JSON</strong> en la ficha de la
          prefactura para importar manualmente los cargos en ADM Cloud.
        </div>
      </Card>
    </div>
  );
}
