"use client";

import { useRef, useState } from "react";
import { Button, Field } from "@/components/ui";
import { CHARGE_UNITS, type ChargeUnit } from "@/lib/schemas/charge.schema";

type ChargeType = { code: string; name: string; default_unit: string };
type Account    = { id: string; name: string };

const UNIT_LABELS: Record<ChargeUnit, string> = {
  container: "Contenedor",
  kg:        "Kg",
  cbm:       "CBM",
  unit:      "Unidad",
  flat:      "Global",
};

export default function CargoForm({
  shipmentId,
  accountId,
  chargeTypes,
  accounts,
  action,
}: {
  shipmentId:  string;
  accountId:   string;
  chargeTypes: ChargeType[];
  accounts:    Account[];
  action:      (formData: FormData) => Promise<void>;
}) {
  const formRef  = useRef<HTMLFormElement>(null);
  const [unit, setUnit] = useState<ChargeUnit>("unit");
  const [selectedType, setSelectedType] = useState("");

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value;
    setSelectedType(code);
    const ct = chargeTypes.find((c) => c.code === code);
    if (ct) setUnit(ct.default_unit as ChargeUnit);
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <input type="hidden" name="shipment_id" value={shipmentId} />

      {/* Tipo de cargo */}
      <div className="sm:col-span-2 lg:col-span-1">
        <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          Tipo de cargo <span aria-hidden>*</span>
        </label>
        <select
          name="charge_type_id"
          required
          value={selectedType}
          onChange={handleTypeChange}
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
        >
          <option value="">— Tipo de cargo —</option>
          {chargeTypes.map((ct) => (
            <option key={ct.code} value={ct.code}>{ct.name}</option>
          ))}
        </select>
      </div>

      {/* Descripción */}
      <div className="sm:col-span-2 lg:col-span-2">
        <Field name="description" label="Descripción" required placeholder="Ej. Flete Santo Domingo → Miami" />
      </div>

      {/* Cantidad */}
      <Field
        name="quantity"
        label="Cantidad"
        required
        type="number"
        placeholder="1"
      />

      {/* Unidad */}
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          Unidad <span aria-hidden>*</span>
        </label>
        <select
          name="unit"
          required
          value={unit}
          onChange={(e) => setUnit(e.target.value as ChargeUnit)}
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
        >
          {CHARGE_UNITS.map((u) => (
            <option key={u} value={u}>{UNIT_LABELS[u]}</option>
          ))}
        </select>
      </div>

      {/* Precio unitario */}
      <Field
        name="unit_price"
        label="Precio unitario"
        required
        type="number"
        placeholder="0.00"
      />

      {/* Moneda */}
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          Moneda
        </label>
        <select
          name="currency"
          defaultValue="USD"
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
        >
          <option value="USD">USD</option>
          <option value="DOP">DOP</option>
        </select>
      </div>

      {/* Tasa de impuesto */}
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          Impuesto (ITBIS)
        </label>
        <select
          name="tax_rate"
          defaultValue="0"
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
        >
          <option value="0">Sin impuesto</option>
          <option value="0.18">18% (ITBIS)</option>
        </select>
      </div>

      {/* Facturar a */}
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--color-text)]">
          Facturar a
        </label>
        <select
          name="bill_to_account_id"
          defaultValue={accountId}
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-focus)]"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
        <Button type="submit">Agregar cargo</Button>
      </div>
    </form>
  );
}
