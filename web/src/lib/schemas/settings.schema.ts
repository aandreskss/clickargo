import { z } from "zod";

export const UpdateTenantSchema = z.object({
  name:               z.string().min(2).max(100),
  tax_id:             z.string().max(20).optional().or(z.literal("")),
  address:            z.string().max(200).optional().or(z.literal("")),
  phone:              z.string().max(30).optional().or(z.literal("")),
  contact_email:      z.string().email().optional().or(z.literal("")),
  secondary_currency: z.enum(["DOP","USD","EUR"]),
  exchange_rate:      z.coerce.number().positive().max(99999),
});

export const UpdateCounterSchema = z.object({
  key:        z.enum(["quotes","shipments","prefactura"]),
  prefix:     z.string().min(1).max(10),
  next_value: z.coerce.number().int().min(1).max(999999),
});

