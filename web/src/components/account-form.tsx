import { Button, Field, Select } from "@/components/ui";
import { ACCOUNT_KINDS, packFor } from "@/lib/field-packs";

type Account = {
  id?: string; kind?: string; name?: string; tax_id?: string | null; email?: string | null;
  phone?: string | null; data?: Record<string, string> | null;
};

export function AccountForm({ action, country, account, submitLabel }: {
  action: (fd: FormData) => Promise<void>; country: string; account?: Account; submitLabel: string;
}) {
  const pack = packFor(country);
  const data = account?.data ?? {};
  return (
    <form action={action} className="space-y-6">
      {account?.id && <input type="hidden" name="id" value={account.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="¿Qué es?" name="kind" options={ACCOUNT_KINDS} defaultValue={account?.kind ?? "customer"} />
        <Field label="Nombre o razón social" name="name" defaultValue={account?.name} placeholder="Importadora Ejemplo SRL" />
        <Field label={pack.taxIdLabel} name="tax_id" required={false} defaultValue={account?.tax_id ?? ""} hint={pack.taxIdHint} />
        <Field label="Teléfono o WhatsApp" name="phone" type="tel" required={false} defaultValue={account?.phone ?? ""} />
        <Field label="Correo" name="email" type="email" required={false} defaultValue={account?.email ?? ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {pack.fields.map((f) => (
          <Field key={f.key} label={f.label} name={`data_${f.key}`} required={false}
            placeholder={f.placeholder} hint={f.hint} defaultValue={data[f.key] ?? ""} />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button>{submitLabel}</Button>
        <a href="/clientes" className="text-sm text-[var(--color-text-muted)] hover:underline">Cancelar</a>
      </div>
    </form>
  );
}
