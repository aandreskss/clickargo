import { z } from "zod";

const ACCOUNT_KIND_VALUES = ["customer", "carrier", "vendor", "agent", "other"] as const;

export const AccountSchema = z.object({
  kind:   z.enum(ACCOUNT_KIND_VALUES),
  name:   z.string().min(1, "El nombre es obligatorio.").max(200),
  tax_id: z.string().max(20).optional().or(z.literal("")),
  email:  z.union([z.string().email("El correo no parece válido."), z.literal("")]).optional(),
  phone:  z.string().max(50).optional().or(z.literal("")),
});

export type AccountInput = z.infer<typeof AccountSchema>;
