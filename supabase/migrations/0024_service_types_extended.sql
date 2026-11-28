-- 0024_service_types_extended.sql
-- AJ1: Tipos de embarque 3 → 6 (aire_export, aduana, transporte).
-- Contenido:
--   1. Extender CHECK service_type en quotes (3 → 6 valores)
--   2. ADD COLUMN service_type en shipments + backfill
--   3. Hacer mode y direction nullable (aduana/transporte no siempre aplican)
--   4. Sembrar contadores por tipo para evitar colisiones de número
--   5. DROP + RECREATE convert_quote_to_shipment (maneja 6 tipos)
--   6. DROP + RECREATE search_shipments (incluye service_type en resultados y filtro)

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Extender service_type en quotes
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_service_type_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_service_type_check
  CHECK (service_type IN (
    'mar_import','mar_export','aire_import','aire_export','aduana','transporte'
  ));

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. ADD service_type en shipments + backfill desde mode+direction
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD COLUMN service_type text CHECK (service_type IN (
    'mar_import','mar_export','aire_import','aire_export','aduana','transporte'
  ));

UPDATE public.shipments
SET service_type = CASE
  WHEN mode = 'ocean' AND direction = 'import' THEN 'mar_import'
  WHEN mode = 'ocean' AND direction = 'export' THEN 'mar_export'
  WHEN mode = 'air'   AND direction = 'import' THEN 'aire_import'
  WHEN mode = 'air'   AND direction = 'export' THEN 'aire_export'
  ELSE 'mar_import'
END
WHERE service_type IS NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Hacer mode y direction nullable
--    Los tipos aduana y transporte no siempre tienen modo/dirección física.
--    El CHECK existente (mode IN ('ocean','air')) pasa NULLs sin problema en PG.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments ALTER COLUMN mode      DROP NOT NULL;
ALTER TABLE public.shipments ALTER COLUMN direction DROP NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Sembrar contadores por tipo de embarque
--    Para evitar colisiones con números existentes (que usan el contador
--    'shipments' unificado), cada nuevo contador empieza desde el valor
--    actual del contador 'shipments' de ese tenant.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tenant_id, value
    FROM public.tenant_counters
    WHERE key = 'shipments'
  LOOP
    INSERT INTO public.tenant_counters (tenant_id, key, value)
    VALUES
      (r.tenant_id, 'shipments_mar_import',   r.value),
      (r.tenant_id, 'shipments_mar_export',   r.value),
      (r.tenant_id, 'shipments_aire_import',  r.value),
      (r.tenant_id, 'shipments_aire_export',  r.value),
      (r.tenant_id, 'shipments_aduana',       r.value),
      (r.tenant_id, 'shipments_transporte',   r.value)
    ON CONFLICT (tenant_id, key) DO NOTHING;
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. DROP + RECREATE convert_quote_to_shipment
--    Ahora maneja los 6 tipos de servicio y usa el contador por tipo.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.convert_quote_to_shipment(uuid, uuid);

CREATE OR REPLACE FUNCTION public.convert_quote_to_shipment(
  _tenant   uuid,
  _quote_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_quote        record;
  v_number       text;
  v_ship_id      uuid;
  v_mode         text;
  v_direction    text;
  v_svc          text;
  v_counter_key  text;
  v_prefix       text;
BEGIN
  IF NOT private.is_member(_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = _quote_id AND tenant_id = _tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  IF v_quote.status != 'accepted' THEN
    RAISE EXCEPTION 'quote_not_acceptable: status=%', v_quote.status;
  END IF;

  v_svc := v_quote.service_type;

  CASE v_svc
    WHEN 'mar_import'  THEN v_mode := 'ocean'; v_direction := 'import';
    WHEN 'mar_export'  THEN v_mode := 'ocean'; v_direction := 'export';
    WHEN 'aire_import' THEN v_mode := 'air';   v_direction := 'import';
    WHEN 'aire_export' THEN v_mode := 'air';   v_direction := 'export';
    ELSE v_mode := NULL; v_direction := NULL; -- aduana, transporte
  END CASE;

  -- Contador y prefijo por tipo. En 0025 se sustituye por get_entity_prefix().
  v_counter_key := 'shipments_' || v_svc;
  v_prefix := CASE v_svc
    WHEN 'mar_import'  THEN 'BXTGMI-'
    WHEN 'mar_export'  THEN 'BXTGME-'
    WHEN 'aire_import' THEN 'BXTGAI-'
    WHEN 'aire_export' THEN 'BXTGAE-'
    WHEN 'aduana'      THEN 'BXTA-'
    WHEN 'transporte'  THEN 'BXTT-'
    ELSE 'EMB-'
  END;

  v_number := public.next_number(_tenant, v_counter_key, v_prefix);

  INSERT INTO public.shipments (
    tenant_id, number, account_id, mode, direction, service_type,
    stage_key, quote_id, notes, created_by
  ) VALUES (
    _tenant, v_number, v_quote.account_id, v_mode, v_direction, v_svc,
    'draft', _quote_id, v_quote.notes, auth.uid()
  )
  RETURNING id INTO v_ship_id;

  UPDATE public.quotes
  SET status = 'converted', updated_at = now()
  WHERE id = _quote_id;

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
-- 6. DROP + RECREATE search_shipments
--    Agrega service_type al resultado y al filtro.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.search_shipments(uuid, text, text, text, text, int);

CREATE OR REPLACE FUNCTION public.search_shipments(
  _tenant       uuid,
  _q            text DEFAULT '',
  _stage        text DEFAULT '',
  _mode         text DEFAULT '',
  _direction    text DEFAULT '',
  _service_type text DEFAULT '',
  _limit        int  DEFAULT 50
) RETURNS TABLE (
  id                  uuid,
  number              text,
  account_id          uuid,
  account_name        text,
  mode                text,
  direction           text,
  service_type        text,
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
    s.service_type,
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
    AND (_stage        = '' OR s.stage_key    = _stage)
    AND (_mode         = '' OR s.mode         = _mode)
    AND (_direction    = '' OR s.direction    = _direction)
    AND (_service_type = '' OR s.service_type = _service_type)
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

REVOKE EXECUTE ON FUNCTION public.search_shipments(uuid, text, text, text, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_shipments(uuid, text, text, text, text, text, int) TO authenticated;
