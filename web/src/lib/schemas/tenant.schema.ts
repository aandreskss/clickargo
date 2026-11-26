import { z } from "zod";

export const CreateTenantSchema = z.object({
  slug:        z.string().regex(/^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/, "Subdominio inválido: usa 3–32 letras minúsculas, números o guiones."),
  name:        z.string().min(1, "El nombre es obligatorio.").max(100),
  country:     z.enum(["DO", "US"]),
  owner_email: z.string().email("El correo del dueño no es válido."),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
