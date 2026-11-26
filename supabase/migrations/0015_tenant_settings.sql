-- 0015_tenant_settings.sql
-- Amplía la tabla tenants con campos de configuración de la empresa:
-- logo, datos fiscales/contacto, segunda moneda y tasa de cambio.
-- También configura el bucket de Storage para activos de la empresa.

-- ── Nuevas columnas en tenants ───────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN logo_url            text,
  ADD COLUMN tax_id              text,         -- RNC (DO), EIN (US), etc.
  ADD COLUMN address             text,
  ADD COLUMN phone               text,
  ADD COLUMN contact_email       text,
  ADD COLUMN secondary_currency  char(3) NOT NULL DEFAULT 'DOP',
  ADD COLUMN exchange_rate       numeric(10,4)  NOT NULL DEFAULT 1,
  ADD COLUMN updated_at          timestamptz    NOT NULL DEFAULT now();

-- Trigger updated_at en tenants (tabla núcleo no lo tenía)
CREATE OR REPLACE FUNCTION private.touch_tenants_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN new.updated_at := now(); RETURN new; END; $$;

CREATE TRIGGER tenants_touch
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION private.touch_tenants_updated_at();

-- ── tenant_by_slug: añadir logo_url para el layout ───────────────────────────
-- DROP primero porque cambia el tipo de retorno (agrega logo_url)
DROP FUNCTION IF EXISTS public.tenant_by_slug(text);
CREATE OR REPLACE FUNCTION public.tenant_by_slug(_slug text)
RETURNS TABLE (
  id       uuid,
  name     text,
  country  char(2),
  locale   text,
  status   public.tenant_status,
  logo_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.id, t.name, t.country, t.locale, t.status, t.logo_url
  FROM public.tenants t WHERE t.slug = lower(_slug);
$$;

-- ── Bucket de Storage: tenant-assets ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-assets', 'tenant-assets', false)
ON CONFLICT (id) DO NOTHING;

-- Lectura: cualquier miembro del tenant puede ver sus archivos
CREATE POLICY "tenant members can view assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'tenant-assets'
    AND private.is_member(((storage.foldername(name))[1])::uuid)
  );

-- Escritura: solo owner/admin pueden subir
CREATE POLICY "owner admin can upload assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-assets'
    AND private.has_role(
      ((storage.foldername(name))[1])::uuid,
      ARRAY['owner','admin']::public.tenant_role[]
    )
  );

-- Actualizar (upsert de logo)
CREATE POLICY "owner admin can update assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-assets'
    AND private.has_role(
      ((storage.foldername(name))[1])::uuid,
      ARRAY['owner','admin']::public.tenant_role[]
    )
  );

-- Eliminar
CREATE POLICY "owner admin can delete assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-assets'
    AND private.has_role(
      ((storage.foldername(name))[1])::uuid,
      ARRAY['owner','admin']::public.tenant_role[]
    )
  );
