-- 0023_portal_tables.sql
-- Fase H: Portal del cliente – tablas de seguimiento y notificaciones
--
-- Contenido:
--   1. tracking_links  — enlaces públicos de seguimiento por embarque
--   2. notification_preferences  — qué eventos notificar por cuenta
--   3. notification_queue  — cola de notificaciones pendientes/enviadas
--   4. get_tracking_shipment()  — RPC pública SECURITY DEFINER (token → datos)
--   5. enqueue_customer_notification()  — trigger SECURITY DEFINER en events/documents
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. tracking_links ─────────────────────────────────────────────────────

CREATE TABLE public.tracking_links (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  shipment_id uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  -- token_hash es sha256 del token aleatorio de 32 bytes; el token RAW NUNCA se guarda en BD
  token_hash  text        NOT NULL UNIQUE,
  revoked_at  timestamptz,
  expires_at  timestamptz,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- un solo enlace activo por embarque; UPSERT lo reemplaza en la action
  UNIQUE (tenant_id, shipment_id)
);

CREATE INDEX tl_tenant_idx ON public.tracking_links (tenant_id, shipment_id);
CREATE INDEX tl_hash_idx   ON public.tracking_links (token_hash);

CREATE TRIGGER tl_lock_tid
  BEFORE UPDATE ON public.tracking_links
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

CREATE TRIGGER tl_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tracking_links
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

ALTER TABLE public.tracking_links ENABLE ROW LEVEL SECURITY;

-- Solo staff gestiona los enlaces; la página pública usa RPC SECURITY DEFINER
CREATE POLICY tl_staff_sel ON public.tracking_links FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY tl_insert ON public.tracking_links FOR INSERT TO authenticated
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY tl_update ON public.tracking_links FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin','manager']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY tl_delete ON public.tracking_links FOR DELETE TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── 2. notification_preferences ───────────────────────────────────────────

CREATE TABLE public.notification_preferences (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  account_id uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_kind text        NOT NULL CHECK (event_kind IN ('stage_changed','eta_changed','document_added')),
  enabled    boolean     NOT NULL DEFAULT true,
  -- destinatarios; guardados aquí para evitar consultar auth.users en el cron
  emails     text[]      NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_id, event_kind)
);

CREATE INDEX np_tenant_idx ON public.notification_preferences (tenant_id, account_id);

CREATE TRIGGER np_updated
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER np_lock_tid
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

CREATE TRIGGER np_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY np_staff_sel ON public.notification_preferences FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY np_customer_sel ON public.notification_preferences FOR SELECT TO authenticated
  USING (
    private.is_customer(tenant_id)
    AND account_id = private.customer_account_id(tenant_id)
  );

CREATE POLICY np_staff_ins ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

CREATE POLICY np_staff_upd ON public.notification_preferences FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin','manager']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY np_staff_del ON public.notification_preferences FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── 3. notification_queue ─────────────────────────────────────────────────

CREATE TABLE public.notification_queue (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('stage_changed','eta_changed','document_added')),
  shipment_id  uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  account_id   uuid        NOT NULL REFERENCES public.accounts(id)  ON DELETE CASCADE,
  payload      jsonb       NOT NULL DEFAULT '{}',
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts     integer     NOT NULL DEFAULT 0,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  error_msg    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nq_pending_idx ON public.notification_queue (status, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX nq_tenant_idx  ON public.notification_queue (tenant_id, account_id);

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY nq_staff_sel ON public.notification_queue FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

-- ── 4. RPC pública: get_tracking_shipment ─────────────────────────────────
-- Recibe sha256(token_raw). Retorna NULL para no-encontrado, revocado y expirado
-- (sin enumeración). Los datos expuestos son solo los públicos.

CREATE OR REPLACE FUNCTION public.get_tracking_shipment(_token_hash text)
RETURNS TABLE (
  shipment_number text,
  stage_key       text,
  mode            text,
  origin_port_id  text,
  dest_port_id    text,
  eta             date,
  events          jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _link public.tracking_links%ROWTYPE;
  _ship public.shipments%ROWTYPE;
BEGIN
  -- Busca el enlace; misma rama para no-encontrado/revocado/expirado
  SELECT * INTO _link
  FROM public.tracking_links
  WHERE token_hash = _token_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO _ship FROM public.shipments WHERE id = _link.shipment_id;

  RETURN QUERY
  SELECT
    _ship.number::text,
    _ship.stage_key::text,
    _ship.mode::text,
    _ship.origin_port_id::text,
    _ship.destination_port_id::text,
    _ship.eta,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'kind',       e.kind,
          'note',       e.note,
          'occurred_at', e.occurred_at
        ) ORDER BY e.occurred_at DESC
      )
      FROM public.shipment_events e
      WHERE e.shipment_id = _ship.id
        AND e.visible_to_customer = true
    ) AS events;
END;
$$;

-- Accesible sin autenticación (anon) para la página pública
REVOKE EXECUTE ON FUNCTION public.get_tracking_shipment(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.get_tracking_shipment(text) TO anon, authenticated;

-- ── 5. Trigger SECURITY DEFINER: enqueue_customer_notification ───────────
-- Encola notificaciones automáticas cuando se inserta un evento o documento
-- visible al cliente. Verifica preferencias antes de insertar.

CREATE OR REPLACE FUNCTION private.enqueue_customer_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _tenant    uuid;
  _account   uuid;
  _kind      text;
  _payload   jsonb;
BEGIN
  -- Determinar tenant, account y kind según la tabla de origen
  IF TG_TABLE_NAME = 'shipment_events' THEN
    -- Solo encolar si es un evento visible al cliente y de tipo notificable
    IF NEW.visible_to_customer IS NOT TRUE THEN
      RETURN NEW;
    END IF;
    IF NEW.kind NOT IN ('stage_changed','eta_changed') THEN
      RETURN NEW;
    END IF;
    _kind    := NEW.kind;
    _payload := jsonb_build_object('note', NEW.note, 'occurred_at', NEW.occurred_at);
    SELECT s.tenant_id, s.account_id INTO _tenant, _account
    FROM public.shipments s WHERE s.id = NEW.shipment_id;

  ELSIF TG_TABLE_NAME = 'shipment_documents' THEN
    IF NEW.visible_to_customer IS NOT TRUE THEN
      RETURN NEW;
    END IF;
    _kind    := 'document_added';
    _payload := jsonb_build_object('filename', NEW.filename);
    SELECT s.tenant_id, s.account_id INTO _tenant, _account
    FROM public.shipments s WHERE s.id = NEW.shipment_id;
  END IF;

  -- Sin account_id no hay cliente al que notificar
  IF _account IS NULL THEN
    RETURN NEW;
  END IF;

  -- Encolar solo si las preferencias están habilitadas (ON CONFLICT DO NOTHING evita duplicados)
  INSERT INTO public.notification_queue
    (tenant_id, kind, shipment_id, account_id, payload)
  SELECT
    _tenant,
    _kind,
    NEW.shipment_id,
    _account,
    _payload
  WHERE EXISTS (
    SELECT 1 FROM public.notification_preferences np
    WHERE np.tenant_id  = _tenant
      AND np.account_id = _account
      AND np.event_kind = _kind
      AND np.enabled    = true
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER se_enqueue_notification
  AFTER INSERT ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_customer_notification();

CREATE TRIGGER sd_enqueue_notification
  AFTER INSERT ON public.shipment_documents
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_customer_notification();
