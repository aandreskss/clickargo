import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const SIGNED_URL_EXPIRES_IN = 300; // 5 minutos

/**
 * Genera una URL firmada de descarga de 5 minutos.
 * Verifica que el storagePath comience con el tenantId para prevenir
 * acceso cruzado entre empresas (path traversal).
 */
export async function getSignedDownloadUrl(
  storagePath: string,
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  // Verificar que el path pertenece al tenant (primer segmento)
  if (!storagePath.startsWith(`${tenantId}/`)) return null;

  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
