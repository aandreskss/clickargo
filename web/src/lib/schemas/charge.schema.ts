import { z } from "zod";

const UUID    = z.string().uuid();
const optText = (max = 500) => z.string().max(max).optional().or(z.literal(""));

export const CHARGE_UNITS = ["container", "kg", "cbm", "unit", "flat", "day"] as const;
export type  ChargeUnit   = typeof CHARGE_UNITS[number];

// ── Cargo de venta ─────────────────────────────────────────────────────────────
export const CreateChargeSchema = z.object({
  shipment_id:        UUID,
  charge_type_id:     z.string().min(1).max(50),
  description:        z.string().min(1).max(500),
  quantity:           z.coerce.number().positive(),
  unit:               z.enum(CHARGE_UNITS),
  unit_price:         z.coerce.number().nonnegative(),
  currency:           z.string().length(3).default("USD"),
  tax_rate:           z.coerce.number().min(0).max(1).default(0),
  bill_to_account_id: UUID.optional().or(z.literal("")),
  sort_order:         z.coerce.number().int().default(0),
});
export type CreateChargeInput = z.infer<typeof CreateChargeSchema>;

export const UpdateChargeSchema = CreateChargeSchema.extend({
  id: UUID,
}).omit({ shipment_id: true });
export type UpdateChargeInput = z.infer<typeof UpdateChargeSchema>;

// ── Costo interno (shipment_charge_costs) ─────────────────────────────────────
export const UpsertChargeCostSchema = z.object({
  shipment_charge_id:  UUID,
  vendor_account_id:   UUID.optional().or(z.literal("")),
  unit_cost:           z.coerce.number().nonnegative(),
  currency:            z.string().length(3).default("USD"),
  vendor_invoice_ref:  optText(200),
});
export type UpsertChargeCostInput = z.infer<typeof UpsertChargeCostSchema>;

// ── Tasa de cambio ────────────────────────────────────────────────────────────
export const CreateExchangeRateSchema = z.object({
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  usd_to_dop:    z.coerce.number().positive(),
  source:        optText(100),
});
export type CreateExchangeRateInput = z.infer<typeof CreateExchangeRateSchema>;
