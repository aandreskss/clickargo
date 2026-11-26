import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/*
 * CANDADO DE SEGURIDAD — leer antes de modificar este archivo.
 *
 * Este es el ÚNICO lugar donde puede vivir un cliente Supabase con service_role.
 * El service_role omite RLS y tiene acceso total a la base de datos.
 *
 * Usos permitidos (actualizar esta lista antes de añadir cualquier otro):
 *   1. Revocar sesiones al desactivar o cambiar el rol de un miembro (actions/team.ts).
 *   2. Webhook de tracking (/api/tracking/[provider]): insertar tracking_events y
 *      llamar refresh_master_suggestion sin sesión de usuario autenticado.
 *   3. Cron de tracking (/api/cron/tracking): poll a proveedores y upsert de eventos.
 *
 * Próximos casos de uso previstos:
 *   - Webhooks de pago (Stripe) que necesiten escribir sin sesión de usuario.
 *   - Webhooks de correo (Resend) para confirmar entregas.
 *   - Scripts de migración de datos ejecutados desde CI, nunca desde el navegador.
 *
 * Prohibido:
 *   - Usar NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY en variables de entorno públicas.
 *   - Llamar desde rutas que el usuario final pueda alcanzar sin validación previa.
 *   - Usar para leer o escribir datos de negocio que el RLS debería filtrar.
 *
 * Ver docs/SEGURIDAD.md para más detalles.
 */

/** Solo para uso en webhooks y cron validados. Ver comentario de seguridad arriba. */
export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada.");
  }
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Revoca todas las sesiones activas de un usuario (para cuando se desactiva o cambia de rol).
 * Usa la API REST de Supabase Auth directamente porque el SDK JS v2 no expone
 * un método admin para revocar sesiones sin eliminar al usuario.
 * Si falla, la columna is_active = false en RLS garantiza el bloqueo de datos. */
export async function revokeUserSessions(userId: string): Promise<void> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`,
      {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:         env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope: "global" }),
      },
    );
  } catch (err) {
    console.error("[admin] revokeUserSessions failed:", err);
  }
}
