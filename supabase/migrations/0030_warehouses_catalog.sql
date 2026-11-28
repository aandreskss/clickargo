-- 0030_warehouses_catalog.sql
-- AJ1: Catálogo de almacenes con unidad de cobro y días libres.
-- Contenido:
--   1. Extender CHECKs de default_unit (charge_types) y unit (shipment_charges)
--      con 'month', 'pallet', 'm2', 'ft3'
--   2. CREATE TABLE warehouses (nombre, billing_unit, free_days, tarifa, etc.)
--   3. ADD warehouse_id FK a storage_stays
--   4. ADD billing_unit a storage_stays (override del warehouses.billing_unit)
--   5. ADD qty a storage_stays (cantidad de pallets/m2/ft3 por estadía)
--   6. RLS en warehouses

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Extender unidades permitidas
--    Los valores 'month','pallet','m2','ft3' permiten modelar cobro mensual,
--    por pallet o por metro cuadrado (Rodemsa / Global Storage) y por ft3
--    (Antillean: 30 días libres + 0.50 USD/ft3/día).
-- ══════════════════════════════════════════════════════════════════════════════

-- charge_types.default_unit
ALTER TABLE public.charge_types
  DROP CONSTRAINT charge_types_default_unit_check,
  ADD CONSTRAINT charge_types_default_unit_check
    CHECK (default_unit IN ('container','kg','cbm','unit','flat','day','month','pallet','m2','ft3'));

-- shipment_charges.unit
ALTER TABLE public.shipment_charges
  DROP CONSTRAINT shipment_charges_unit_check,
  ADD CONSTRAINT shipment_charges_unit_check
    CHECK (unit IN ('container','kg','cbm','unit','flat','day','month','pallet','m2','ft3'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Tabla warehouses — catálogo de almacenes por empresa
--    billing_unit: unidad de cobro del almacén
--      day    = por día (ej. almacén convencional)
--      month  = por mes
--      pallet = por pallet/mes (Rodemsa, Global Storage)
--      m2     = por m2/mes
--      ft3    = por ft3/día (Antillean: 30 días libres + 0.50/ft3/día)
--    default_free_days: días libres por defecto (ej. Antillean = 30)
--    default_rate: tarifa base por unidad de cobro
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.warehouses (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid         NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name               text         NOT NULL,
  billing_unit       text         NOT NULL
                     CHECK (billing_unit IN ('day','month','pallet','m2','ft3')),
  default_free_days  integer      NOT NULL DEFAULT 0 CHECK (default_free_days >= 0),
  default_rate       numeric(14,4) NOT NULL DEFAULT 0 CHECK (default_rate >= 0),
  currency           char(3)      NOT NULL DEFAULT 'USD',
  notes              text,
  active             boolean      NOT NULL DEFAULT true,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

COMMENT ON COLUMN public.warehouses.billing_unit IS
  'Unidad de cobro: day=día, month=mes, pallet=pallet/mes, m2=m²/mes, ft3=ft³/día (ej. Antillean).';
COMMENT ON COLUMN public.warehouses.default_free_days IS
  'Días libres por defecto (Antillean = 30). La estadía puede sobreescribirlo.';
COMMENT ON COLUMN public.warehouses.default_rate IS
  'Tarifa base negociada por unidad de cobro. La estadía puede sobreescribirla.';

CREATE INDEX wh_tenant_idx ON public.warehouses (tenant_id, active);

CREATE TRIGGER wh_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER wh_updated
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER wh_lock_tid
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY wh_sel ON public.warehouses FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));
CREATE POLICY wh_ins ON public.warehouses FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));
CREATE POLICY wh_upd ON public.warehouses FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));
CREATE POLICY wh_del ON public.warehouses FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]));

REVOKE ALL ON TABLE public.warehouses FROM anon;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. storage_stays: ADD warehouse_id
--    Nullable — estadías existentes no tienen almacén asignado en catálogo.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.storage_stays
  ADD COLUMN warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL;

CREATE INDEX ss_warehouse_idx ON public.storage_stays (warehouse_id)
  WHERE warehouse_id IS NOT NULL;

COMMENT ON COLUMN public.storage_stays.warehouse_id IS
  'Almacén del catálogo. Null = almacén no listado o dato histórico.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. storage_stays: ADD billing_unit
--    Permite sobreescribir la unidad del almacén por estadía.
--    Default 'day' para mantener compatibilidad con estadías existentes.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.storage_stays
  ADD COLUMN billing_unit text NOT NULL DEFAULT 'day'
    CHECK (billing_unit IN ('day','month','pallet','m2','ft3'));

COMMENT ON COLUMN public.storage_stays.billing_unit IS
  'Unidad de cobro de esta estadía (puede diferir del almacén por acuerdo especial).';

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. storage_stays: ADD qty
--    Cantidad de unidades físicas: pallets, m2, ft3.
--    Para billing_unit=day, qty=1 (una unidad de carga).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.storage_stays
  ADD COLUMN qty numeric(14,4) NOT NULL DEFAULT 1 CHECK (qty > 0);

COMMENT ON COLUMN public.storage_stays.qty IS
  'Cantidad de unidades (pallets, m2, ft3). Para cobro por día simple, mantener en 1.';
