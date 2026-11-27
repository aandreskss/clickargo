import { z } from "zod";

const UUID    = z.string().uuid();
const dateRe  = /^\d{4}-\d{2}-\d{2}$/;

export const CreateStorageStaySchema = z.object({
  shipment_id:         UUID,
  provider_account_id: UUID.optional().or(z.literal("")),
  location_note:       z.string().max(300).optional().or(z.literal("")),
  in_date:             z.string().regex(dateRe),
  free_days:           z.coerce.number().int().min(0).default(0),
  sell_rate_per_day:   z.coerce.number().min(0).default(0),
  currency:            z.string().length(3).default("USD"),
  notes:               z.string().max(1000).optional().or(z.literal("")),
});
export type CreateStorageStayInput = z.infer<typeof CreateStorageStaySchema>;

export const ReleaseStorageStaySchema = z.object({
  id:          UUID,
  shipment_id: UUID,
  out_date:    z.string().regex(dateRe),
});
export type ReleaseStorageStayInput = z.infer<typeof ReleaseStorageStaySchema>;

export const CreateChargeFromStaySchema = z.object({
  stay_id:     UUID,
  shipment_id: UUID,
});
export type CreateChargeFromStayInput = z.infer<typeof CreateChargeFromStaySchema>;

export const UpsertStorageStayCostSchema = z.object({
  stay_id:            UUID,
  shipment_id:        UUID,
  cost_rate_per_day:  z.coerce.number().min(0),
  vendor_invoice_ref: z.string().max(200).optional().or(z.literal("")),
});
export type UpsertStorageStayCostInput = z.infer<typeof UpsertStorageStayCostSchema>;
