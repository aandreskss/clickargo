import { z } from "zod";

export const QuoteLineSchema = z.object({
  id:         z.string().uuid().optional(),
  service:    z.string().min(1).max(200),
  qty:        z.number().positive(),
  unit_price: z.number().nonnegative(),
  currency:   z.string().min(3).max(3).default("USD"),
  taxable:    z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

// line_index = posición 0-based de la línea a la que pertenece este costo.
// Se resuelve a quote_line_id real en el Server Action tras insertar las líneas.
export const QuoteLineCostSchema = z.object({
  line_index: z.number().int().nonnegative(),
  cost:       z.number().nonnegative(),
  currency:   z.string().min(3).max(3).default("USD"),
  vendor_id:  z.string().uuid().optional().or(z.literal("")),
  notes:      z.string().max(500).optional().or(z.literal("")),
});

export const CreateQuoteSchema = z.object({
  account_id:   z.string().uuid(),
  service_type: z.enum(["mar_import", "mar_export", "aire_import"]),
  origin:       z.string().max(100).optional().or(z.literal("")),
  destination:  z.string().max(100).optional().or(z.literal("")),
  currency:     z.string().min(3).max(3).default("USD"),
  notes:        z.string().max(1000).optional().or(z.literal("")),
  valid_until:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  lines:        z.array(QuoteLineSchema).min(1),
  line_costs:   z.array(QuoteLineCostSchema).optional(),
});

export const UpdateQuoteSchema = CreateQuoteSchema.extend({
  id: z.string().uuid(),
});

export const ChangeStatusSchema = z.object({
  id:     z.string().uuid(),
  status: z.enum(["draft", "sent", "accepted", "expired", "rejected"]),
});

export type QuoteLineInput = z.infer<typeof QuoteLineSchema>;
export type QuoteLineCostInput = z.infer<typeof QuoteLineCostSchema>;
export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>;
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteSchema>;
