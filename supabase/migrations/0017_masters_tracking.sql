-- 0017_masters_tracking.sql
-- Fase D: Masters / House y Tracking.
-- Contenido:
--   1. CREATE TABLE masters
--   2. CREATE TABLE master_containers
--   3. CREATE TABLE tracking_events (append-only)
--   4. ALTER masters — FK circular a tracking_events
--   5. ALTER shipments — FK master_id + índice
--   6. ALTER shipment_containers — columna master_container_id
--   7. RLS en las tres tablas nuevas
--   8. private.recalc_master_stage — helper interno
--   9. RPCs:
--        search_masters, link_shipment_to_master, unlink_shipment_from_master,
--        update_master_schedule, upsert_tracking_event, refresh_master_suggestion,
--        accept_tracking_suggestion, dismiss_tracking_suggestion, tracking_suggestions

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. CREATE TABLE masters
--    pending_suggestion_event_id sin FK aún (tracking_events no existe todavía).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.masters (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number                      text        NOT NULL,                    -- MST-000001
  master_number               text        NOT NULL,                    -- MBL o MAWB
  mode                        text        NOT NULL CHECK (mode IN ('ocean','air')),
  carrier_account_id          uuid        REFERENCES public.accounts(id) ON DELETE SET NULL,
  vessel_or_flight            text,
  voyage                      text,
  origin_port_id              text        REFERENCES public.ports(code),
  destination_port_id         text        REFERENCES public.ports(code),
  etd                         date,
  eta                         date,
  atd                         date,
  ata                         date,
  stage_key                   text        NOT NULL DEFAULT 'draft',    -- etapa más atrasada de los houses activos
  tracking_enabled            boolean     NOT NULL DEFAULT false,
  tracking_provider           text,                                    -- 'terminal49' | 'manual'
  tracking_ref                text,                                    -- referencia con el proveedor (MBL, container, etc.)
  last_tracked_at             timestamptz,
  pending_suggestion_stage    text,                                    -- sugerencia pendiente (null si no hay)
  pending_suggestion_event_id bigint,                                  -- FK a tracking_events (se agrega en paso 4)
  pending_suggestion_at       timestamptz,
  notes                       text,
  internal_notes              text,
  created_by                  uuid        DEFAULT auth.uid(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, master_number)
);

CREATE INDEX masters_tenant_idx    ON public.masters (tenant_id, created_at DESC);
CREATE INDEX masters_eta_idx       ON public.masters (tenant_id, eta) WHERE eta IS NOT NULL;
CREATE INDEX masters_tracking_idx  ON public.masters (tracking_ref) WHERE tracking_ref IS NOT NULL;
CREATE INDEX masters_suggestion_idx ON public.masters (tenant_id) WHERE pending_suggestion_stage IS NOT NULL;

CREATE TRIGGER masters_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.masters
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER masters_updated
  BEFORE UPDATE ON public.masters
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER masters_lock_tid
  BEFORE UPDATE ON public.masters
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CREATE TABLE master_containers
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.master_containers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  master_id          uuid        NOT NULL REFERENCES public.masters(id) ON DELETE CASCADE,
  container_number   text,
  container_type_id  text        REFERENCES public.container_types(code),
  seal_number        text,
  weight_kg          numeric(12,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX master_containers_master_idx ON public.master_containers (master_id);

CREATE TRIGGER master_containers_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.master_containers
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER master_containers_updated
  BEFORE UPDATE ON public.master_containers
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER master_containers_lock_tid
  BEFORE UPDATE ON public.master_containers
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CREATE TABLE tracking_events (append-only)
--    bigint GENERATED ALWAYS AS IDENTITY — alto volumen, secuencial.
--    UNIQUE(master_id, provider, event_code, occurred_at) garantiza idempotencia.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.tracking_events (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  master_id    uuid        NOT NULL REFERENCES public.masters(id) ON DELETE CASCADE,
  provider     text        NOT NULL,
  event_code   text        NOT NULL,
  event_label  text        NOT NULL,
  location     text,
  occurred_at  timestamptz NOT NULL,
  raw          jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- payload crudo; jamás ejecutado
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_id, provider, event_code, occurred_at)
);

CREATE INDEX tracking_events_master_idx  ON public.tracking_events (master_id, occurred_at DESC);
CREATE INDEX tracking_events_tenant_idx  ON public.tracking_events (tenant_id, occurred_at DESC);

-- Append-only: private.deny_mutation() existe desde migración 0009.
CREATE TRIGGER tracking_events_no_update
  BEFORE UPDATE ON public.tracking_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();
CREATE TRIGGER tracking_events_no_delete
  BEFORE DELETE ON public.tracking_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. ALTER masters — FK circular a tracking_events
--    Ahora que tracking_events existe, se puede agregar la FK.
--    ON DELETE SET NULL: si el evento se borra (no debería — append-only),
--    la sugerencia queda huérfana pero no explota.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.masters
  ADD CONSTRAINT masters_suggestion_event_fkey
  FOREIGN KEY (pending_suggestion_event_id)
  REFERENCES public.tracking_events(id)
  ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. ALTER shipments — FK master_id (dejada sin constraint en 0016)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_master_id_fkey
  FOREIGN KEY (master_id)
  REFERENCES public.masters(id)
  ON DELETE SET NULL;

CREATE INDEX shipments_master_idx ON public.shipments (master_id) WHERE master_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. ALTER shipment_containers — referencia opcional al contenedor del master
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipment_containers
  ADD COLUMN master_container_id uuid REFERENCES public.master_containers(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.masters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_events   ENABLE ROW LEVEL SECURITY;

-- ── masters ───────────────────────────────────────────────────────────────────
CREATE POLICY masters_sel ON public.masters FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY masters_ins ON public.masters FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]));

CREATE POLICY masters_upd ON public.masters FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY masters_del ON public.masters FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── master_containers ─────────────────────────────────────────────────────────
CREATE POLICY master_containers_sel ON public.master_containers FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY master_containers_ins ON public.master_containers FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]));

CREATE POLICY master_containers_upd ON public.master_containers FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY master_containers_del ON public.master_containers FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── tracking_events (solo lectura desde cliente; INSERT solo vía SECURITY DEFINER) ──
CREATE POLICY tracking_events_sel ON public.tracking_events FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

-- Sin INSERT policy directa → inserción solo vía RPC upsert_tracking_event o admin client.
-- Sin UPDATE/DELETE policies → append-only (triggers deny_mutation son segunda barrera).

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. REVOKE anon en tablas nuevas
-- ══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON TABLE public.masters           FROM anon;
REVOKE ALL ON TABLE public.master_containers FROM anon;
REVOKE ALL ON TABLE public.tracking_events   FROM anon;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9a. HELPER PRIVADO: private.recalc_master_stage
--     Recalcula stage_key del master = etapa más atrasada de los houses activos.
--     Llamada desde link/unlink y accept_tracking_suggestion.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.recalc_master_stage(
  _master_id uuid,
  _tenant_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_stage text;
BEGIN
  SELECT s.stage_key INTO v_stage
  FROM public.shipments s
  JOIN public.stage_definitions sd ON sd.tenant_id = _tenant_id AND sd.key = s.stage_key
  WHERE s.master_id = _master_id
    AND s.tenant_id = _tenant_id
    AND s.stage_key NOT IN ('completed', 'cancelled')
  ORDER BY sd.sort_order ASC
  LIMIT 1;

  IF v_stage IS NOT NULL THEN
    UPDATE public.masters
    SET stage_key = v_stage, updated_at = now()
    WHERE id = _master_id AND tenant_id = _tenant_id;
  END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9b. RPC search_masters
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.search_masters(
  _tenant uuid,
  _q      text DEFAULT '',
  _mode   text DEFAULT '',
  _limit  int  DEFAULT 50
) RETURNS TABLE (
  id                  uuid,
  number              text,
  master_number       text,
  mode                text,
  carrier_name        text,
  vessel_or_flight    text,
  origin_port_id      text,
  destination_port_id text,
  eta                 date,
  stage_key           text,
  tracking_enabled    boolean,
  pending_suggestion_stage text,
  updated_at          timestamptz,
  created_at          timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    m.id,
    m.number,
    m.master_number,
    m.mode,
    a.name     AS carrier_name,
    m.vessel_or_flight,
    m.origin_port_id,
    m.destination_port_id,
    m.eta,
    m.stage_key,
    m.tracking_enabled,
    m.pending_suggestion_stage,
    m.updated_at,
    m.created_at
  FROM public.masters m
  LEFT JOIN public.accounts a ON a.id = m.carrier_account_id
  WHERE m.tenant_id = _tenant
    AND private.is_member(_tenant)
    AND (_mode = '' OR m.mode = _mode)
    AND (
      _q = ''
      OR m.number        ILIKE '%' || _q || '%'
      OR m.master_number ILIKE '%' || _q || '%'
      OR m.vessel_or_flight ILIKE '%' || _q || '%'
      OR a.name          ILIKE '%' || _q || '%'
    )
  ORDER BY m.created_at DESC
  LIMIT _limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_masters(uuid, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_masters(uuid, text, text, int) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9c. RPC link_shipment_to_master
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.link_shipment_to_master(
  _tenant      uuid,
  _shipment_id uuid,
  _master_id   uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ship_mode  text;
  v_ship_stage text;
  v_mast_mode  text;
BEGIN
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT mode, stage_key INTO v_ship_mode, v_ship_stage
  FROM public.shipments
  WHERE id = _shipment_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'shipment_not_found'; END IF;
  IF v_ship_stage IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'shipment_terminal';
  END IF;

  SELECT mode INTO v_mast_mode
  FROM public.masters
  WHERE id = _master_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'master_not_found'; END IF;
  IF v_ship_mode != v_mast_mode THEN
    RAISE EXCEPTION 'mode_mismatch';
  END IF;

  UPDATE public.shipments
  SET master_id = _master_id, updated_at = now()
  WHERE id = _shipment_id AND tenant_id = _tenant;

  PERFORM private.recalc_master_stage(_master_id, _tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_shipment_to_master(uuid, uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.link_shipment_to_master(uuid, uuid, uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9d. RPC unlink_shipment_from_master
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.unlink_shipment_from_master(
  _tenant      uuid,
  _shipment_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_master_id uuid;
BEGIN
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT master_id INTO v_master_id
  FROM public.shipments
  WHERE id = _shipment_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'shipment_not_found'; END IF;

  UPDATE public.shipments
  SET master_id = NULL, updated_at = now()
  WHERE id = _shipment_id AND tenant_id = _tenant;

  IF v_master_id IS NOT NULL THEN
    PERFORM private.recalc_master_stage(v_master_id, _tenant);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unlink_shipment_from_master(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.unlink_shipment_from_master(uuid, uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9e. RPC update_master_schedule
--     Actualiza fechas y buque del master, propaga a todos los houses activos,
--     e inserta shipment_events (visible al cliente solo si cambió la ETA).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_master_schedule(
  _tenant           uuid,
  _master_id        uuid,
  _eta              date DEFAULT NULL,
  _etd              date DEFAULT NULL,
  _atd              date DEFAULT NULL,
  _ata              date DEFAULT NULL,
  _vessel_or_flight text DEFAULT NULL,
  _voyage           text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old   record;
  v_ship  record;
  v_eta_changed boolean;
BEGIN
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT eta, etd, atd, ata, vessel_or_flight, voyage INTO v_old
  FROM public.masters
  WHERE id = _master_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'master_not_found'; END IF;

  v_eta_changed := _eta IS NOT NULL AND _eta IS DISTINCT FROM v_old.eta;

  -- Actualizar master (COALESCE: NULL = "no cambiar")
  UPDATE public.masters
  SET
    eta              = COALESCE(_eta,              eta),
    etd              = COALESCE(_etd,              etd),
    atd              = COALESCE(_atd,              atd),
    ata              = COALESCE(_ata,              ata),
    vessel_or_flight = COALESCE(_vessel_or_flight, vessel_or_flight),
    voyage           = COALESCE(_voyage,           voyage),
    updated_at       = now()
  WHERE id = _master_id AND tenant_id = _tenant;

  -- Propagar a houses no terminales
  FOR v_ship IN
    SELECT id FROM public.shipments
    WHERE master_id = _master_id AND tenant_id = _tenant
      AND stage_key NOT IN ('completed','cancelled')
  LOOP
    UPDATE public.shipments
    SET
      eta              = COALESCE(_eta,              eta),
      etd              = COALESCE(_etd,              etd),
      atd              = COALESCE(_atd,              atd),
      ata              = COALESCE(_ata,              ata),
      vessel_or_flight = COALESCE(_vessel_or_flight, vessel_or_flight),
      voyage           = COALESCE(_voyage,           voyage),
      updated_at       = now()
    WHERE id = v_ship.id;

    IF v_eta_changed THEN
      INSERT INTO public.shipment_events
        (tenant_id, shipment_id, kind, message, visible_to_customer, actor_id)
      VALUES
        (_tenant, v_ship.id, 'eta_changed',
         'ETA actualizada a ' || _eta::text || ' por cambio en el master',
         true, auth.uid());
    ELSIF _etd IS NOT NULL OR _vessel_or_flight IS NOT NULL OR _voyage IS NOT NULL
          OR _atd IS NOT NULL OR _ata IS NOT NULL THEN
      INSERT INTO public.shipment_events
        (tenant_id, shipment_id, kind, message, visible_to_customer, actor_id)
      VALUES
        (_tenant, v_ship.id, 'system',
         'Itinerario actualizado desde el master',
         false, auth.uid());
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_master_schedule(uuid,uuid,date,date,date,date,text,text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.update_master_schedule(uuid,uuid,date,date,date,date,text,text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9f. private.refresh_master_suggestion
--     Evalúa el último evento y actualiza pending_suggestion_* en masters.
--     Solo service_role y funciones SECURITY DEFINER pueden llamarla.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refresh_master_suggestion(
  _master_id uuid,
  _event_id  bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant_id      uuid;
  v_event_code     text;
  v_suggested      text;
  v_suggested_sort integer;
  v_houses_behind  integer;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.masters WHERE id = _master_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT event_code INTO v_event_code
  FROM public.tracking_events
  WHERE id = _event_id AND master_id = _master_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mapeo Terminal49 event_code → etapa estándar
  v_suggested := CASE v_event_code
    WHEN 'container.pickup'    THEN 'picked_up'
    WHEN 'vessel.departure'    THEN 'in_transit'
    WHEN 'vessel.arrival'      THEN 'at_destination'
    WHEN 'container.discharge' THEN 'at_destination'
    WHEN 'container.delivery'  THEN 'delivered'
    ELSE NULL
  END;
  IF v_suggested IS NULL THEN RETURN; END IF;

  SELECT sd.sort_order INTO v_suggested_sort
  FROM public.stage_definitions sd
  WHERE sd.tenant_id = v_tenant_id AND sd.key = v_suggested
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_houses_behind
  FROM public.shipments s
  JOIN public.stage_definitions sd ON sd.tenant_id = v_tenant_id AND sd.key = s.stage_key
  WHERE s.master_id = _master_id
    AND s.tenant_id = v_tenant_id
    AND s.stage_key NOT IN ('completed','cancelled')
    AND sd.sort_order < v_suggested_sort;

  IF v_houses_behind > 0 THEN
    UPDATE public.masters
    SET pending_suggestion_stage    = v_suggested,
        pending_suggestion_event_id = _event_id,
        pending_suggestion_at       = now(),
        updated_at                  = now()
    WHERE id = _master_id;
  END IF;
END;
$$;

-- Solo service_role (admin client / webhook) y SECURITY DEFINER internamente.
REVOKE EXECUTE ON FUNCTION public.refresh_master_suggestion(uuid, bigint) FROM public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9g. RPC upsert_tracking_event
--     Para eventos manuales desde la UI (usuario autenticado).
--     Idempotente: ON CONFLICT DO NOTHING.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_tracking_event(
  _tenant      uuid,
  _master_id   uuid,
  _provider    text,
  _event_code  text,
  _event_label text,
  _location    text          DEFAULT NULL,
  _occurred_at timestamptz   DEFAULT now(),
  _raw         jsonb         DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_event_id bigint;
BEGIN
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.masters WHERE id = _master_id AND tenant_id = _tenant
  ) THEN
    RAISE EXCEPTION 'master_not_found';
  END IF;

  INSERT INTO public.tracking_events
    (tenant_id, master_id, provider, event_code, event_label, location, occurred_at, raw)
  VALUES
    (_tenant, _master_id, _provider, _event_code, _event_label, _location, _occurred_at, _raw)
  ON CONFLICT (master_id, provider, event_code, occurred_at) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    PERFORM public.refresh_master_suggestion(_master_id, v_event_id);
  END IF;

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_tracking_event(uuid,uuid,text,text,text,text,timestamptz,jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_tracking_event(uuid,uuid,text,text,text,text,timestamptz,jsonb) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9h. RPC accept_tracking_suggestion
--     Avanza todos los houses activos por detrás del stage sugerido.
--     Retorna el número de houses avanzados.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.accept_tracking_suggestion(
  _tenant    uuid,
  _master_id uuid
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pending_stage text;
  v_event_id      bigint;
  v_stage_sort    integer;
  v_provider      text;
  v_ship          record;
  v_new_stage     text;
  v_count         int := 0;
BEGIN
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT pending_suggestion_stage, pending_suggestion_event_id
  INTO v_pending_stage, v_event_id
  FROM public.masters
  WHERE id = _master_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'master_not_found'; END IF;
  IF v_pending_stage IS NULL THEN RETURN 0; END IF;

  SELECT provider INTO v_provider
  FROM public.tracking_events WHERE id = v_event_id;

  SELECT sd.sort_order INTO v_stage_sort
  FROM public.stage_definitions sd
  WHERE sd.tenant_id = _tenant AND sd.key = v_pending_stage
  LIMIT 1;

  IF NOT FOUND THEN
    -- Sugerencia obsoleta, limpiar
    UPDATE public.masters
    SET pending_suggestion_stage    = NULL,
        pending_suggestion_event_id = NULL,
        pending_suggestion_at       = NULL,
        updated_at                  = now()
    WHERE id = _master_id AND tenant_id = _tenant;
    RETURN 0;
  END IF;

  FOR v_ship IN
    SELECT s.id, s.stage_key
    FROM public.shipments s
    JOIN public.stage_definitions sd ON sd.tenant_id = _tenant AND sd.key = s.stage_key
    WHERE s.master_id = _master_id
      AND s.tenant_id = _tenant
      AND s.stage_key NOT IN ('completed','cancelled')
      AND sd.sort_order < v_stage_sort
  LOOP
    UPDATE public.shipments
    SET stage_key = v_pending_stage, updated_at = now()
    WHERE id = v_ship.id;

    INSERT INTO public.shipment_events
      (tenant_id, shipment_id, kind, from_stage, to_stage, message, visible_to_customer, actor_id)
    VALUES
      (_tenant, v_ship.id, 'stage_changed',
       v_ship.stage_key, v_pending_stage,
       'Avanzado por sugerencia de tracking (' || COALESCE(v_provider, 'tracking') || ')',
       true, auth.uid());

    v_count := v_count + 1;
  END LOOP;

  -- Recalcular etapa del master
  SELECT s.stage_key INTO v_new_stage
  FROM public.shipments s
  JOIN public.stage_definitions sd ON sd.tenant_id = _tenant AND sd.key = s.stage_key
  WHERE s.master_id = _master_id AND s.tenant_id = _tenant
    AND s.stage_key NOT IN ('completed','cancelled')
  ORDER BY sd.sort_order ASC
  LIMIT 1;

  UPDATE public.masters
  SET stage_key                  = COALESCE(v_new_stage, v_pending_stage),
      pending_suggestion_stage    = NULL,
      pending_suggestion_event_id = NULL,
      pending_suggestion_at       = NULL,
      updated_at                  = now()
  WHERE id = _master_id AND tenant_id = _tenant;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_tracking_suggestion(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.accept_tracking_suggestion(uuid, uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9i. RPC dismiss_tracking_suggestion
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.dismiss_tracking_suggestion(
  _tenant    uuid,
  _master_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin','manager','operator']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.masters
  SET pending_suggestion_stage    = NULL,
      pending_suggestion_event_id = NULL,
      pending_suggestion_at       = NULL,
      updated_at                  = now()
  WHERE id = _master_id AND tenant_id = _tenant;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_tracking_suggestion(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.dismiss_tracking_suggestion(uuid, uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9j. RPC tracking_suggestions
--     Retorna masters con sugerencia pendiente para el dashboard.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tracking_suggestions(
  _tenant uuid
) RETURNS TABLE (
  master_id                uuid,
  number                   text,
  master_number            text,
  pending_suggestion_stage text,
  pending_suggestion_at    timestamptz,
  houses_count             int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    m.id AS master_id,
    m.number,
    m.master_number,
    m.pending_suggestion_stage,
    m.pending_suggestion_at,
    (SELECT COUNT(*)::int
     FROM public.shipments s
     WHERE s.master_id = m.id
       AND s.stage_key NOT IN ('completed','cancelled')) AS houses_count
  FROM public.masters m
  WHERE m.tenant_id = _tenant
    AND private.is_member(_tenant)
    AND m.pending_suggestion_stage IS NOT NULL
  ORDER BY m.pending_suggestion_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_suggestions(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.tracking_suggestions(uuid) TO authenticated;
