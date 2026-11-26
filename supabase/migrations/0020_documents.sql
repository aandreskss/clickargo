-- 0020_documents.sql
-- Fase F: Plantillas de documentos, documentos adjuntos de embarque, correos enviados
-- y bucket de Storage privado para documentos.
-- Contenido:
--   1. document_templates  — config de PDFs por tipo y empresa (quote, arrival_notice, pre_invoice)
--   2. shipment_documents  — archivos adjuntos a embarques (BL, facturas, etc.)
--   3. outbound_emails     — historial de correos enviados (append-only)
--   4. Storage bucket "documents" con políticas de tenant
--   5. Trigger de seed: 3 plantillas por defecto al crear empresa

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. document_templates
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.document_templates (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind        text    NOT NULL CHECK (kind IN ('quote','arrival_notice','pre_invoice')),
  name        text    NOT NULL,
  -- config keys: show_logo bool, footer_text text, terms_text text, primary_color hex (#rrggbb)
  config      jsonb   NOT NULL DEFAULT '{}',
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Solo un is_default=true por (tenant, kind)
CREATE UNIQUE INDEX dt_one_default_per_kind
  ON public.document_templates (tenant_id, kind)
  WHERE is_default = true;

CREATE INDEX dt_tenant_idx ON public.document_templates (tenant_id);

CREATE TRIGGER dt_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

CREATE TRIGGER dt_updated
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER dt_lock_tid
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

-- Cualquier miembro puede ver las plantillas de su empresa
CREATE POLICY dt_sel ON public.document_templates FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

-- Solo owner/admin pueden crear/editar/eliminar plantillas
CREATE POLICY dt_ins ON public.document_templates FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY dt_upd ON public.document_templates FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY dt_del ON public.document_templates FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]));

-- ══════════════════════════════════════════════════════════════════════════════
-- Seed: crear 3 plantillas por defecto al crear una empresa nueva
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.on_tenant_created_seed_doc_templates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.document_templates (tenant_id, kind, name, is_default)
  VALUES
    (NEW.id, 'quote',          'Cotización estándar',      true),
    (NEW.id, 'arrival_notice', 'Aviso de llegada estándar', true),
    (NEW.id, 'pre_invoice',    'Prefactura estándar',       true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_seed_doc_templates
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION private.on_tenant_created_seed_doc_templates();

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. shipment_documents
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipment_documents (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Una de las dos FKs debe ser NOT NULL (validado en la action, no en BD por flexibilidad futura)
  shipment_id         uuid    REFERENCES public.shipments(id) ON DELETE CASCADE,
  quote_id            uuid    REFERENCES public.quotes(id) ON DELETE CASCADE,
  kind                text    NOT NULL CHECK (kind IN (
                        'bl','awb','commercial_invoice','packing_list',
                        'customs_declaration','arrival_notice','other')),
  title               text    NOT NULL,
  storage_path        text    NOT NULL,  -- {tenant_id}/{shipment_id}/{uuid}.{ext}
  mime_type           text    NOT NULL,
  size_bytes          integer NOT NULL CHECK (size_bytes > 0),
  -- clean: validado (magic bytes OK); pending: en cola AV; quarantined: detectado como peligroso
  scan_status         text    NOT NULL DEFAULT 'clean'
                        CHECK (scan_status IN ('pending','clean','quarantined')),
  visible_to_customer boolean NOT NULL DEFAULT false,
  uploaded_by         uuid    NOT NULL REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sd_shipment_idx ON public.shipment_documents (tenant_id, shipment_id, created_at DESC);
CREATE INDEX sd_quote_idx    ON public.shipment_documents (tenant_id, quote_id);
CREATE INDEX sd_uploader_idx ON public.shipment_documents (uploaded_by);

CREATE TRIGGER sd_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipment_documents
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

CREATE TRIGGER sd_lock_tid
  BEFORE UPDATE ON public.shipment_documents
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.shipment_documents ENABLE ROW LEVEL SECURITY;

-- Solo archivos limpios son visibles para miembros normales
CREATE POLICY sd_sel ON public.shipment_documents FOR SELECT TO authenticated
  USING (private.is_member(tenant_id) AND scan_status = 'clean');

-- Cualquier miembro activo puede subir documentos
CREATE POLICY sd_ins ON public.shipment_documents FOR INSERT TO authenticated
  WITH CHECK (private.is_member(tenant_id));

-- owner/admin/manager pueden actualizar metadatos (title, kind, visible_to_customer)
CREATE POLICY sd_upd ON public.shipment_documents FOR UPDATE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

-- El uploader puede borrar su propio archivo; owner/admin/manager pueden borrar cualquiera
CREATE POLICY sd_del ON public.shipment_documents FOR DELETE TO authenticated
  USING (
    private.is_member(tenant_id) AND (
      uploaded_by = auth.uid()
      OR private.has_role(tenant_id,
        ARRAY['owner','admin','manager']::public.tenant_role[])
    )
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. outbound_emails — historial de correos enviados (append-only)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.outbound_emails (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  to_email            text    NOT NULL,
  subject             text    NOT NULL,
  -- tipo de documento que originó el correo
  template            text    NOT NULL CHECK (template IN ('quote','arrival_notice','pre_invoice')),
  related_type        text    CHECK (related_type IN ('quote','shipment','pre_invoice')),
  related_id          uuid,
  status              text    NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('queued','sent','failed')),
  provider_message_id text,   -- ID devuelto por Resend
  error               text,   -- detalle del error (solo visible en logs de servidor)
  created_by          uuid    NOT NULL REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oe_tenant_idx    ON public.outbound_emails (tenant_id, created_at DESC);
CREATE INDEX oe_related_idx   ON public.outbound_emails (tenant_id, related_type, related_id);
CREATE INDEX oe_creator_idx   ON public.outbound_emails (created_by);

CREATE TRIGGER oe_audit
  AFTER INSERT OR DELETE ON public.outbound_emails
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

-- Append-only: private.deny_mutation() existe desde migración 0009
CREATE TRIGGER oe_no_update
  BEFORE UPDATE ON public.outbound_emails
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

CREATE TRIGGER oe_no_delete
  BEFORE DELETE ON public.outbound_emails
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

ALTER TABLE public.outbound_emails ENABLE ROW LEVEL SECURITY;

-- Cualquier miembro puede ver el historial de correos
CREATE POLICY oe_sel ON public.outbound_emails FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

-- Cualquier miembro puede registrar un correo enviado
CREATE POLICY oe_ins ON public.outbound_emails FOR INSERT TO authenticated
  WITH CHECK (private.is_member(tenant_id));

-- UPDATE y DELETE bloqueados por trigger (append-only); no se crean políticas

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Storage bucket "documents" — archivos adjuntos de embarques
-- ══════════════════════════════════════════════════════════════════════════════
-- Ruta de archivos: {tenant_id}/{shipment_id}/{uuid}.{ext}
-- El primer segmento del path siempre es el tenant_id.

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Lectura: cualquier miembro del tenant puede ver sus documentos
CREATE POLICY "tenant members can view documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND private.is_member(((storage.foldername(name))[1])::uuid)
  );

-- Subida: cualquier miembro activo puede subir documentos
CREATE POLICY "tenant members can upload documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND private.is_member(((storage.foldername(name))[1])::uuid)
  );

-- Eliminación: cualquier miembro del tenant (la granularidad del "quién puede borrar"
-- se impone en la capa de aplicación + RLS de shipment_documents)
CREATE POLICY "tenant members can delete documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND private.is_member(((storage.foldername(name))[1])::uuid)
  );
