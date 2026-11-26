import "server-only";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").split(":")[0];

/**
 * Deriva el tenant a partir del header Host de la petición entrante.
 * Nunca acepta el tenant de un campo del formulario ni de un parámetro de ruta.
 * Devuelve null si la petición no llega desde un subdominio de empresa válido.
 */
export async function tenantFromHost() {
  const host = (await headers()).get("host") ?? "";
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname.endsWith(`.${ROOT}`)) return null;
  const slug = hostname.slice(0, -(ROOT.length + 1));
  if (!slug) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("tenant_by_slug", { _slug: slug });
  return data?.[0] ?? null;
}
