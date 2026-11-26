-- 0016_shipments.sql
-- Fase C: Embarques.
-- Contenido:
--   1. ALTER stage_definitions — columnas faltantes + seed RPC
--   2. CREATE shipments
--   3. CREATE shipment_containers
--   4. CREATE shipment_events (append-only)
--   5. ALTER quotes — agrega status 'converted'
--   6. RLS en las tres tablas nuevas
--   7. RPCs: search_shipments, convert_quote_to_shipment, seed_stage_definitions
--   8. REVOKE/GRANT

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ALTER TABLE stage_definitions
--    La tabla existe desde 0014 con: id, tenant_id, name, sort_order, color,
--    created_at y UNIQUE(tenant_id, name). Aquí se agregan las columnas que
--    necesita la Fase C y se crea el índice de unicidad sobre (tenant_id, key).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.stage_definitions
  ADD COLUMN key              text,
  ADD COLUMN label            text,
  ADD COLUMN mode             text CHECK (mode IN ('ocean','air','both')),
  ADD COLUMN direction        text CHECK (direction IN ('import','export','both')),
  ADD COLUMN visible_to_customer boolean NOT NULL DEFAULT true,
  ADD COLUMN is_terminal         boolean NOT NULL DEFAULT false;

-- key se hace NOT NULL después de que seed_stage_definitions rellena las filas.
-- Para tenants sin filas existentes el ALTER es inmediato.
-- Para tenants con filas (si ya se aplicó un seed manual), la RPC es idempotente.

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CREATE TABLE shipments
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number                  text        NOT NULL,
  account_id              uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  mode                    text        NOT NULL CHECK (mode IN ('ocean','air')),
  direction               text        NOT NULL CHECK (direction IN ('import','export')),
  stage_key               text        NOT NULL DEFAULT 'draft',
  origin_port_id          text        REFERENCES public.ports(code),
  destination_port_id     text        REFERENCES public.ports(code),
  incoterm                text        REFERENCES public.incoterms(code),
  carrier_account_id      uuid        REFERENCES public.accounts(id),
  vessel_or_flight        text,
  voyage                  text,
  etd                     date,
  eta                     date,
  atd                     date,
  ata                     date,
  booking_number          text,
  bl_number               text,
  cargo_description       text,
  packages                integer     CHECK (packages IS NULL OR packages > 0),
  weight_kg               numeric(12,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  volume_cbm              numeric(12,3) CHECK (volume_cbm IS NULL OR volume_cbm >= 0),
  customer_reference      text,
  shipper_account_id      uuid        REFERENCES public.accounts(id),
  consignee_account_id    uuid        REFERENCES public.accounts(id),
  notify_party_account_id uuid        REFERENCES public.accounts(id),
  quote_id                uuid        REFERENCES public.quotes(id),
  master_id               uuid,       -- FK se agrega en Fase D (master_bills)
  data                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes                   text,
  internal_notes          text,
  created_by              uuid        DEFAULT auth.uid(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE INDEX shipments_tenant_idx   ON public.shipments (tenant_id, created_at DESC);
CREATE INDEX shipments_account_idx  ON public.shipments (tenant_id, account_id);
CREATE INDEX shipments_stage_idx    ON public.shipments (tenant_id, stage_key);
CREATE INDEX shipments_eta_idx      ON public.shipments (tenant_id, eta) WHERE eta IS NOT NULL;
CREATE INDEX shipments_quote_idx    ON public.shipments (quote_id)       WHERE quote_id IS NOT NULL;

CREATE TRIGGER shipments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER shipments_updated
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER shipments_lock_tid
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CREATE TABLE shipment_containers
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipment_containers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id        uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  container_number   text,
  container_type_id  text        REFERENCES public.container_types(code),
  seal_number        text,
  weight_kg          numeric(12,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX containers_shipment_idx ON public.shipment_containers (shipment_id);

CREATE TRIGGER containers_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipment_containers
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER containers_updated
  BEFORE UPDATE ON public.shipment_containers
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER containers_lock_tid
  BEFORE UPDATE ON public.shipment_containers
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. CREATE TABLE shipment_events (append-only)
--    bigint GENERATED ALWAYS AS IDENTITY — igual que audit_log (registros
--    de alto volumen, secuenciales, no necesitan UUID).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipment_events (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id         uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  kind                text        NOT NULL
                      CHECK (kind IN ('stage_changed','eta_changed','note','document','tracking','system')),
  from_stage          text,
  to_stage            text,
  message             text,
  visible_to_customer boolean     NOT NULL DEFAULT false,
  actor_id            uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_shipment_idx ON public.shipment_events (shipment_id, created_at DESC);
CREATE INDEX events_tenant_idx   ON public.shipment_events (tenant_id,   created_at DESC);

-- Append-only: private.deny_mutation() existe desde migración 0009.
CREATE TRIGGER events_no_update
  BEFORE UPDATE ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();
CREATE TRIGGER events_no_delete
  BEFORE DELETE ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. ALTER quotes — agregar status 'converted'
--    Necesario para que convert_quote_to_shipment pueda marcar la cotización.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft','sent','accepted','expired','rejected','converted'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_events     ENABLE ROW LEVEL SECURITY;

-- ── shipments ────────────────────────────────────────────────────────────────
CREATE POLICY shipments_sel ON public.shipments FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY shipments_ins ON public.shipments FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]));

CREATE POLICY shipments_upd ON public.shipments FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY shipments_del ON public.shipments FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── shipment_containers ──────────────────────────────────────────────────────
CREATE POLICY containers_sel ON public.shipment_containers FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY containers_ins ON public.shipment_containers FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]));

CREATE POLICY containers_upd ON public.shipment_containers FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY containers_del ON public.shipment_containers FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── shipment_events (solo lectura + append desde cliente) ───────────────────
CREATE POLICY events_sel ON public.shipment_events FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY events_ins ON public.shipment_events FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]));

-- Sin UPDATE/DELETE policies → denegado (el trigger deny_mutation es segunda barrera).

-- ══════════════════════════════════════════════════════════════════════════════
-- 7a. RPC search_shipments
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.search_shipments(
  _tenant    uuid,
  _q         text DEFAULT '',
  _stage     text DEFAULT '',
  _mode      text DEFAULT '',
  _direction text DEFAULT '',
  _limit     int  DEFAULT 50
) RETURNS TABLE (
  id                  uuid,
  number              text,
  account_id          uuid,
  account_name        text,
  mode                text,
  direction           text,
  stage_key           text,
  origin_port_id      text,
  destination_port_id text,
  eta                 date,
  updated_at          timestamptz,
  created_at          timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    s.id,
    s.number,
    s.account_id,
    a.name,
    s.mode,
    s.direction,
    s.stage_key,
    s.origin_port_id,
    s.destination_port_id,
    s.eta,
    s.updated_at,
    s.created_at
  FROM public.shipments s
  LEFT JOIN public.accounts a ON a.id = s.account_id
  WHERE s.tenant_id = _tenant
    AND private.is_member(_tenant)
    AND (_stage     = '' OR s.stage_key  = _stage)
    AND (_mode      = '' OR s.mode       = _mode)
    AND (_direction = '' OR s.direction  = _direction)
    AND (
      _q = ''
      OR s.number         ILIKE '%' || _q || '%'
      OR s.bl_number      ILIKE '%' || _q || '%'
      OR s.booking_number ILIKE '%' || _q || '%'
      OR a.name           ILIKE '%' || _q || '%'
    )
  ORDER BY s.created_at DESC
  LIMIT _limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_shipments(uuid, text, text, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_shipments(uuid, text, text, text, text, int) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7b. RPC convert_quote_to_shipment
--     Convierte una cotización aceptada en un embarque borrador.
--     Retorna el UUID del nuevo embarque.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.convert_quote_to_shipment(
  _tenant   uuid,
  _quote_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_quote     record;
  v_number    text;
  v_ship_id   uuid;
  v_mode      text;
  v_direction text;
BEGIN
  IF NOT private.is_member(_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Fetch quote (must be accepted and belong to tenant)
  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = _quote_id AND tenant_id = _tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  IF v_quote.status != 'accepted' THEN
    RAISE EXCEPTION 'quote_not_acceptable: status=%', v_quote.status;
  END IF;

  -- Derive mode and direction from service_type
  CASE v_quote.service_type
    WHEN 'mar_import'  THEN v_mode := 'ocean'; v_direction := 'import';
    WHEN 'mar_export'  THEN v_mode := 'ocean'; v_direction := 'export';
    WHEN 'aire_import' THEN v_mode := 'air';   v_direction := 'import';
    ELSE                    v_mode := 'ocean'; v_direction := 'import';
  END CASE;

  -- Generate shipment number
  v_number := public.next_number(_tenant, 'shipments', 'EMB-');

  -- Create draft shipment
  INSERT INTO public.shipments (
    tenant_id, number, account_id, mode, direction,
    stage_key, quote_id, notes, created_by
  ) VALUES (
    _tenant, v_number, v_quote.account_id, v_mode, v_direction,
    'draft', _quote_id, v_quote.notes, auth.uid()
  )
  RETURNING id INTO v_ship_id;

  -- Mark quote as converted
  UPDATE public.quotes
  SET status = 'converted', updated_at = now()
  WHERE id = _quote_id;

  -- Log the event
  INSERT INTO public.shipment_events (
    tenant_id, shipment_id, kind, to_stage,
    message, visible_to_customer, actor_id
  ) VALUES (
    _tenant, v_ship_id, 'stage_changed', 'draft',
    'Embarque creado desde cotización ' || v_quote.number,
    false, auth.uid()
  );

  RETURN v_ship_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convert_quote_to_shipment(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.convert_quote_to_shipment(uuid, uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7c. RPC seed_stage_definitions
--     Siembra las 10 etapas estándar para un tenant.
--     Idempotente: no hace nada si el tenant ya tiene etapas.
--     Solo owner/admin pueden llamarla.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_stage_definitions(_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stage_definitions WHERE tenant_id = _tenant) THEN
    RETURN;
  END IF;

  INSERT INTO public.stage_definitions
    (tenant_id, key, label, name, sort_order, mode, direction, visible_to_customer, is_terminal)
  VALUES
    (_tenant, 'draft',            'Borrador',      'Borrador',      1,  'both', 'both', false, false),
    (_tenant, 'booked',           'Reservado',     'Reservado',     2,  'both', 'both', true,  false),
    (_tenant, 'picked_up',        'Recogido',      'Recogido',      3,  'both', 'both', true,  false),
    (_tenant, 'at_origin',        'En origen',     'En origen',     4,  'both', 'both', true,  false),
    (_tenant, 'in_transit',       'En tránsito',   'En tránsito',   5,  'both', 'both', true,  false),
    (_tenant, 'at_destination',   'En destino',    'En destino',    6,  'both', 'both', true,  false),
    (_tenant, 'out_for_delivery', 'En reparto',    'En reparto',    7,  'both', 'both', true,  false),
    (_tenant, 'delivered',        'Entregado',     'Entregado',     8,  'both', 'both', true,  false),
    (_tenant, 'completed',        'Completado',    'Completado',    9,  'both', 'both', true,  true),
    (_tenant, 'cancelled',        'Cancelado',     'Cancelado',     10, 'both', 'both', false, true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_stage_definitions(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.seed_stage_definitions(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. REVOKE anon en tablas nuevas
-- ══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON TABLE public.shipments           FROM anon;
REVOKE ALL ON TABLE public.shipment_containers FROM anon;
REVOKE ALL ON TABLE public.shipment_events     FROM anon;

-- Crear índice único de key DESPUÉS de que el seed pueda haber corrido.
-- Para bases limpias (sin stage_definitions aún), esto aplica de inmediato.
-- Para bases con filas existentes sin key, el DBA debe correr
-- seed_stage_definitions() antes de aplicar el índice.
CREATE UNIQUE INDEX stage_defs_tenant_key_idx
  ON public.stage_definitions (tenant_id, key)
  WHERE key IS NOT NULL;
