import { createClient } from "@/lib/supabase/server";
import { tenantFromHost } from "@/lib/tenant";
import { decode } from "@/lib/messages";
import { updateTenantSettings, uploadLogo } from "@/app/actions/settings";
import { PageHeader, Card, Field, Select, Button, Notice, Tabs } from "@/components/ui";

const AJUSTES_TABS = [
  { value: "empresa",     label: "Empresa",     href: "/ajustes/empresa"     },
  { value: "numeracion",  label: "Numeración",  href: "/ajustes/numeracion"  },
  { value: "equipo",      label: "Equipo",      href: "/ajustes/equipo"      },
  { value: "cargos",      label: "Cargos",      href: "/ajustes/cargos"      },
  { value: "integracion",    label: "Integración",    href: "/ajustes/integracion"    },
  { value: "plantillas",     label: "Plantillas",     href: "/ajustes/plantillas"     },
  { value: "notificaciones", label: "Notificaciones", href: "/ajustes/notificaciones" },
];

const CURRENCIES = [
  { value: "DOP", label: "DOP – Peso dominicano" },
  { value: "USD", label: "USD – Dólar americano"  },
  { value: "EUR", label: "EUR – Euro"              },
] as const;

export default async function AjustesEmpresa({ searchParams }: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const tenant   = await tenantFromHost();

  const { data: t } = await supabase
    .from("tenants")
    .select("name, tax_id, address, phone, contact_email, secondary_currency, exchange_rate, logo_url")
    .eq("id", tenant.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" />
      <Tabs tabs={AJUSTES_TABS} active="empresa" />
      <Notice error={decode(error)} info={decode(ok)} />

      {/* ── Datos de la empresa ── */}
      <Card>
        <h2 className="mb-4 text-base font-semibold text-[var(--color-text)]">Datos de la empresa</h2>
        <form action={updateTenantSettings} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Nombre comercial" name="name" defaultValue={t?.name ?? ""} />
          </div>
          <Field label="RNC / ID fiscal" name="tax_id" defaultValue={t?.tax_id ?? ""} required={false} />
          <Field label="Teléfono" name="phone" type="tel" defaultValue={t?.phone ?? ""} required={false} />
          <div className="sm:col-span-2">
            <Field label="Correo de contacto" name="contact_email" type="email" defaultValue={t?.contact_email ?? ""} required={false} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Dirección" name="address" defaultValue={t?.address ?? ""} required={false} />
          </div>

          <Select
            label="Segunda moneda"
            name="secondary_currency"
            options={CURRENCIES}
            defaultValue={t?.secondary_currency ?? "DOP"}
          />
          <Field
            label="Tasa de cambio (1 USD = ? segunda moneda)"
            name="exchange_rate"
            type="number"
            inputMode="decimal"
            defaultValue={String(t?.exchange_rate ?? 1)}
          />

          <div className="sm:col-span-2 flex justify-end">
            <Button>Guardar cambios</Button>
          </div>
        </form>
      </Card>

      {/* ── Logo ── */}
      <Card>
        <h2 className="mb-1 text-base font-semibold text-[var(--color-text)]">Logo de la empresa</h2>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          PNG, JPG o WebP · máximo 2 MB. Se mostrará en documentos y en el portal del cliente.
        </p>
        {t?.logo_url && (
          <div className="mb-4">
            <span className="text-xs text-[var(--color-text-muted)]">Logo actual: {t.logo_url.split("/").pop()}</span>
          </div>
        )}
        <form action={uploadLogo} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">Subir nuevo logo</span>
            <input
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              className="block text-sm text-[var(--color-text-muted)] file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-[var(--color-surface-muted)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--color-text)]"
            />
          </label>
          <Button>Subir logo</Button>
        </form>
      </Card>
    </div>
  );
}
