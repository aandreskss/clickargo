-- 0014_charge_types.sql
-- Tipos de cargo por empresa (cargos de cotizaciones y embarques).
-- stage_definitions: etapas personalizables del proceso (seed en Fase C).

-- ── Tipos de cargo ───────────────────────────────────────────────────────────
CREATE TABLE public.charge_types (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code         text    NOT NULL,
  name         text    NOT NULL,
  default_unit text,                            -- BL, KG, CONT, %, VIAJE, DÍA…
  taxable      boolean NOT NULL DEFAULT false,  -- aplica ITBIS (18%)
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX charge_types_tenant_idx ON public.charge_types (tenant_id, active);

-- ── Etapas del proceso (estructura; seed en Fase C) ──────────────────────────
CREATE TABLE public.stage_definitions (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name       text    NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ── Triggers ─────────────────────────────────────────────────────────────────
CREATE TRIGGER charge_types_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.charge_types
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

CREATE TRIGGER charge_types_touch
  BEFORE UPDATE ON public.charge_types
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER charge_types_lock_tenant
  BEFORE UPDATE ON public.charge_types
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

CREATE TRIGGER stage_definitions_lock_tenant
  BEFORE UPDATE ON public.stage_definitions
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.charge_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_definitions ENABLE ROW LEVEL SECURITY;

-- charge_types: todo el equipo lee; solo owner/admin escribe
CREATE POLICY charge_types_select ON public.charge_types FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY charge_types_insert ON public.charge_types FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY charge_types_update ON public.charge_types FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY charge_types_delete ON public.charge_types FOR DELETE TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

-- stage_definitions: mismo esquema
CREATE POLICY stage_defs_select ON public.stage_definitions FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY stage_defs_insert ON public.stage_definitions FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY stage_defs_update ON public.stage_definitions FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY stage_defs_delete ON public.stage_definitions FOR DELETE TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

-- ── RPC: sembrar cargos por defecto (idempotente) ────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_default_charge_types(_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Solo siembra si la empresa no tiene cargos todavía
  IF EXISTS (SELECT 1 FROM public.charge_types WHERE tenant_id = _tenant) THEN
    RETURN;
  END IF;

  INSERT INTO public.charge_types (tenant_id, code, name, default_unit, taxable) VALUES
    (_tenant, 'FLT-MAR', 'Flete marítimo',            'BL',    false),
    (_tenant, 'FLT-AIR', 'Flete aéreo',               'KG',    false),
    (_tenant, 'BAF',     'Recargo por combustible',    'BL',    false),
    (_tenant, 'THC-ORI', 'THC origen',                 'CONT',  false),
    (_tenant, 'THC-DST', 'THC destino',                'CONT',  false),
    (_tenant, 'MNJ',     'Manejo / Handling',          'BL',    false),
    (_tenant, 'SEG',     'Seguro de carga',            '%',     false),
    (_tenant, 'DSP',     'Despacho aduanal',           'BL',    true),
    (_tenant, 'TRP-LOC', 'Transporte local',           'VIAJE', true),
    (_tenant, 'ALM',     'Almacenaje',                 'DÍA',   false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_charge_types(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.seed_default_charge_types(uuid) TO authenticated;
