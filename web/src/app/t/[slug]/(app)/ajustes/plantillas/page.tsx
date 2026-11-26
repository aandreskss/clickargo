import { createClient }  from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { decode }         from "@/lib/messages";
import { updateDocumentTemplate } from "@/app/actions/documents";
import { PageHeader, Card, Field, Button, Notice, Tabs } from "@/components/ui";

const AJUSTES_TABS = [
  { value: "empresa",     label: "Empresa",     href: "/ajustes/empresa"     },
  { value: "numeracion",  label: "Numeración",  href: "/ajustes/numeracion"  },
  { value: "equipo",      label: "Equipo",      href: "/ajustes/equipo"      },
  { value: "cargos",      label: "Cargos",      href: "/ajustes/cargos"      },
  { value: "integracion", label: "Integración", href: "/ajustes/integracion" },
  { value: "plantillas",  label: "Plantillas",  href: "/ajustes/plantillas"  },
];

type TemplateKind = "quote" | "arrival_notice" | "pre_invoice";

const KIND_META: Record<TemplateKind, { label: string; pdfPath: string }> = {
  quote:          { label: "Cotización",       pdfPath: "/api/documentos/cotizacion"     },
  arrival_notice: { label: "Aviso de llegada", pdfPath: "/api/documentos/embarque-aviso" },
  pre_invoice:    { label: "Prefactura",        pdfPath: "/api/documentos/prefactura"     },
};

const KINDS: TemplateKind[] = ["quote", "arrival_notice", "pre_invoice"];

const DEFAULT_CONFIG = { show_logo: true, footer_text: "", terms_text: "", primary_color: "#1D4ED8" };

export default async function AjustesPlantillas({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  // Cargar plantillas existentes
  const { data: existing } = await supabase
    .from("document_templates")
    .select("id, kind, name, config")
    .eq("tenant_id", tenant.id)
    .eq("is_default", true);

  const existingMap = new Map((existing ?? []).map((t) => [t.kind, t]));

  // Crear las que falten
  const missing = KINDS.filter((k) => !existingMap.has(k));
  if (missing.length > 0) {
    const { data: inserted } = await supabase
      .from("document_templates")
      .insert(
        missing.map((kind) => ({
          tenant_id:  tenant.id,
          kind,
          name:       KIND_META[kind].label,
          config:     DEFAULT_CONFIG,
          is_default: true,
        })),
      )
      .select("id, kind, name, config");
    for (const row of inserted ?? []) existingMap.set(row.kind, row);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" />
      <Tabs tabs={AJUSTES_TABS} active="plantillas" />
      <Notice error={decode(error)} info={decode(ok)} />

      <div className="space-y-4">
        {KINDS.map((kind) => {
          const tpl  = existingMap.get(kind);
          if (!tpl) return null;
          const cfg  = (tpl.config ?? {}) as Record<string, unknown>;
          const meta = KIND_META[kind];

          return (
            <Card key={kind}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-[var(--color-text)]">{meta.label}</h2>
              </div>

              <form action={updateDocumentTemplate} className="space-y-4">
                <input type="hidden" name="id" value={tpl.id} />

                {/* Show logo */}
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="show_logo"
                    value="true"
                    defaultChecked={cfg.show_logo !== false}
                    className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                  />
                  <span className="text-[var(--color-text)]">Mostrar logo en el PDF</span>
                </label>

                <Field
                  label="Pie de página"
                  name="footer_text"
                  required={false}
                  placeholder="Ej: Box To Go · RNC 123456789"
                  defaultValue={typeof cfg.footer_text === "string" ? cfg.footer_text : ""}
                />

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">
                    Términos / pasos siguientes{" "}
                    <span className="font-normal text-[var(--color-text-muted)]">(opcional)</span>
                  </span>
                  <textarea
                    name="terms_text"
                    rows={4}
                    placeholder="Ej: Esta cotización tiene vigencia de 15 días hábiles."
                    defaultValue={typeof cfg.terms_text === "string" ? cfg.terms_text : ""}
                    className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-text)] outline-none transition focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-border-focus)]/20"
                  />
                </label>

                <Field
                  label="Color principal (hex)"
                  name="primary_color"
                  required={false}
                  placeholder="#1D4ED8"
                  defaultValue={typeof cfg.primary_color === "string" ? cfg.primary_color : "#1D4ED8"}
                />

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button type="submit">Guardar</Button>
                </div>
              </form>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
