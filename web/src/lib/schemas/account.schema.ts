import { z } from "zod";

const ACCOUNT_KIND_VALUES = ["customer", "carrier", "vendor", "agent", "other"] as const;

export const TAX_ID_TYPES = ["RNC", "RUT", "Tax ID", "ID", "VAT"] as const;
export type TaxIdType = typeof TAX_ID_TYPES[number];

const RNC_RE = /^\d{9}$|^\d{11}$/;

export const AccountSchema = z.object({
  kind:        z.enum(ACCOUNT_KIND_VALUES),
  name:        z.string().min(1, "El nombre es obligatorio.").max(200),
  tax_id_type: z.enum(TAX_ID_TYPES).optional().or(z.literal("")),
  tax_id:      z.string().max(20).optional().or(z.literal("")),
  email:       z.union([z.string().email("El correo no parece válido."), z.literal("")]).optional(),
  phone:       z.string().max(50).optional().or(z.literal("")),
  credit_days: z.coerce.number().int().refine((v) => [0, 15, 21, 30].includes(v), {
    message: "Días de crédito debe ser 0, 15, 21 o 30.",
  }).default(0),
}).superRefine((data, ctx) => {
  if (data.tax_id_type === "RNC" && data.tax_id && !RNC_RE.test(data.tax_id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tax_id"],
      message: "El RNC debe tener 9 u 11 dígitos numéricos.",
    });
  }
});

export const AccountContactSchema = z.object({
  account_id: z.string().uuid(),
  name:       z.string().min(1).max(200),
  email:      z.union([z.string().email(), z.literal("")]).optional(),
  phone:      z.string().max(50).optional().or(z.literal("")),
  role_label: z.string().max(100).optional().or(z.literal("")),
  is_primary: z.boolean().default(false),
});

export type AccountInput = z.infer<typeof AccountSchema>;
export type AccountContactInput = z.infer<typeof AccountContactSchema>;
