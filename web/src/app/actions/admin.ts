"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CreateTenantSchema } from "@/lib/schemas/tenant.schema";
import { errUrl, okUrl } from "@/lib/messages";
import { isReservedSlug } from "@/lib/reserved-slugs";

export async function createTenant(formData: FormData) {
  const parsed = CreateTenantSchema.safeParse({
    slug:        String(formData.get("slug") ?? "").trim().toLowerCase(),
    name:        String(formData.get("name") ?? "").trim(),
    country:     String(formData.get("country") ?? "DO"),
    owner_email: String(formData.get("owner_email") ?? "").trim(),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "";
    const key = /subdominio|slug/i.test(msg) ? "slug_invalido" : "error_generico";
    redirect(errUrl("/admin", key as "slug_invalido" | "error_generico"));
  }

  const { slug, name, country, owner_email } = parsed.data;

  // Doble verificación: el trigger de BD también lo comprueba, pero este error es más legible.
  if (isReservedSlug(slug)) redirect(errUrl("/admin", "slug_reservado"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_tenant", {
    _slug: slug,
    _name: name,
    _country: country,
    _owner_email: owner_email,
  });

  if (error) {
    const key =
      /duplicate|unique/i.test(error.message) ? "subdominio_en_uso" :
      /reservado|reserved/i.test(error.message) ? "slug_reservado" :
      "error_generico";
    redirect(errUrl("/admin", key as "subdominio_en_uso" | "slug_reservado" | "error_generico"));
  }

  revalidatePath("/admin");
  redirect(okUrl("/admin", "empresa_creada"));
}
