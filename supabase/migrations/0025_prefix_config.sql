-- 0025_prefix_config.sql
-- AJ1: Prefijos de numeración configurables por empresa y por tipo de entidad.
-- Contenido:
--   1. Tabla tenant_prefix_config (tenant_id, entity_key, prefix)
--   2. RLS en tenant_prefix_config
--   3. Función get_entity_prefix — retorna prefix configurado o default del sistema
--   4. Actualizar convert_quote_to_shipment para usar get_entity_prefix
--   5. Actualizar quotes action para que el backend pueda obtener el prefijo de cotización

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Tabla tenant_prefix_config
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.tenant_prefix_config (
  tenant_id    uuid  NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_key   text  NOT NULL,  -- 'quotes', 'shipments_mar_import', 'shipments_aduana', etc.
  prefix       text  NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_key)
);

CREATE TRIGGER prefix_config_updated
  BEFORE UPDATE ON public.tenant_prefix_config
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER prefix_config_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_prefix_config
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tenant_prefix_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY prefix_config_sel ON public.tenant_prefix_config FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY prefix_config_ins ON public.tenant_prefix_config FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY prefix_config_upd ON public.tenant_prefix_config FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY prefix_config_del ON public.tenant_prefix_config FOR DELETE TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

REVOKE ALL ON TABLE public.tenant_prefix_config FROM anon;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Función get_entity_prefix
--    Retorna el prefijo configurado para el tenant y la clave de entidad.
--    Si no hay configuración, usa los defaults del sistema (Box To Go style).
--    Accesible por todos los miembros autenticados.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_entity_prefix(_tenant uuid, _key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT prefix
     FROM public.tenant_prefix_config
     WHERE tenant_id = _tenant AND entity_key = _key),
    -- Defaults del sistema
    CASE _key
      WHEN 'quotes'                THEN 'BXCT-'
      WHEN 'pre_invoices'          THEN ''          -- derivado de COT/EMB (0031)
      WHEN 'shipments_mar_import'  THEN 'BXTGMI-'
      WHEN 'shipments_mar_export'  THEN 'BXTGME-'
      WHEN 'shipments_aire_import' THEN 'BXTGAI-'
      WHEN 'shipments_aire_export' THEN 'BXTGAE-'
      WHEN 'shipments_aduana'      THEN 'BXTA-'
      WHEN 'shipments_transporte'  THEN 'BXTT-'
      ELSE ''
    END
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_entity_prefix(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_entity_prefix(uuid, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Actualizar convert_quote_to_shipment para usar get_entity_prefix
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.convert_quote_to_shipment(uuid, uuid);

CREATE OR REPLACE FUNCTION public.convert_quote_to_shipment(
  _tenant   uuid,
  _quote_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_quote       record;
  v_number      text;
  v_ship_id     uuid;
  v_mode        text;
  v_direction   text;
  v_svc         text;
  v_counter_key text;
  v_prefix      text;
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
    ELSE v_mode := NULL; v_direction := NULL;
  END CASE;

  v_counter_key := 'shipments_' || v_svc;
  v_prefix      := public.get_entity_prefix(_tenant, v_counter_key);

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
-- 5. Actualizar el prefijo de cotizaciones
--    La acción de quotes en TS también debe usar get_entity_prefix. Este script
--    migra el contador 'quotes' para que siga la nomenclatura por clave estándar.
--    No hace nada en BD; el TS action se actualiza en el mismo deployment.
-- ══════════════════════════════════════════════════════════════════════════════

-- (Sin cambio de BD para quotes; la acción TS leerá get_entity_prefix.)
-- Instrucción post-deploy: si el tenant ya tiene registros, el contador 'quotes'
-- ya tiene el valor correcto. get_entity_prefix devolverá 'BXCT-' por defecto.
