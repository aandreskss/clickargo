-- 0010_integration_credentials_schema.sql
-- PLACEHOLDER: esquema para credenciales de integraciones. No usar hasta Fase F.
--
-- Cifrado: AES-256-GCM app-side.
-- La llave de cifrado vive en INTEGRATION_SECRET_KEY (variable de entorno, server-only).
-- El valor almacenado es: base64(nonce_12bytes || ciphertext || tag_16bytes).
-- La UI muestra solo los últimos 4 caracteres del valor descifrado, nunca el valor completo.
-- Cada lectura queda en security_events (event_type = 'credential_accessed').
-- Implementar en Fase F junto con src/lib/crypto.ts (AES-256-GCM)
-- y src/app/actions/integrations.ts.

CREATE TABLE public.integration_credentials (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider    text        NOT NULL,          -- 'adm_cloud', 'tracking_x', etc.
  label       text        NOT NULL,
  secret_enc  text        NOT NULL,          -- valor cifrado en la app (ver comentario arriba)
  created_by  uuid        DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

-- Solo owner y admin pueden leer sus propias credenciales.
CREATE POLICY integration_credentials_select ON public.integration_credentials FOR SELECT TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

-- Solo owner y admin pueden insertar/actualizar.
CREATE POLICY integration_credentials_insert ON public.integration_credentials FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY integration_credentials_update ON public.integration_credentials FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY integration_credentials_delete ON public.integration_credentials FOR DELETE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE TRIGGER integration_credentials_touch BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER integration_credentials_lock_tenant BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();
