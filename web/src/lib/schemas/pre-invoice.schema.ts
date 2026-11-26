import { z } from "zod";

const UUID    = z.string().uuid();
const optText = (max = 500) => z.string().max(max).optional().or(z.literal(""));

export const PRE_INVOICE_STATUSES = [
  "draft", "ready", "sent_to_erp", "invoiced", "void",
] as const;
export type PreInvoiceStatus = typeof PRE_INVOICE_STATUSES[number];

// ── Crear prefactura ──────────────────────────────────────────────────────────
export const CreatePreInvoiceSchema = z.object({
  charge_ids:    z.string().min(1), // JSON: uuid[]
  notes:         optText(1000),
  exchange_rate: z.coerce.number().positive().optional().or(z.literal("")),
});
export type CreatePreInvoiceInput = z.infer<typeof CreatePreInvoiceSchema>;

// ── Registrar número de factura ERP ──────────────────────────────────────────
export const MarkInvoicedSchema = z.object({
  id:                UUID,
  erp_document_ref:  z.string().min(1).max(200),
});
export type MarkInvoicedInput = z.infer<typeof MarkInvoicedSchema>;

// ── Guardar credenciales ERP ──────────────────────────────────────────────────
export const SaveCredentialsSchema = z.object({
  provider:   z.string().min(1).max(50),
  api_key:    z.string().min(1).max(2000),
  base_url:   z.string().url().optional().or(z.literal("")),
});
export type SaveCredentialsInput = z.infer<typeof SaveCredentialsSchema>;
