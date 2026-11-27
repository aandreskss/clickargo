-- 0021_storage_stays.sql
-- Fase G: Almacenaje con terceros.
-- Contenido:
--   1. Extender shipment_charges.unit con valor 'day'
--   2. Seed tipo de cargo 'almacenaje'
--   3. storage_stays  — estadías de almacenaje por embarque
--   4. storage_stay_costs — costos internos (1:1, protegido por can_see_costs)

-- ══════════════════════════════════════════════════════════════════════════════
-- 1a. Extender charge_types.default_unit para incluir 'day'
--     (0018 solo tenía container/kg/cbm/unit/flat)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.charge_types
  DROP CONSTRAINT charge_types_default_unit_check,
  ADD CONSTRAINT charge_types_default_unit_check
    CHECK (default_unit IN ('container','kg','cbm','unit','flat','day'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 1b. Extender shipment_charges.unit para incluir 'day'
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipment_charges
  DROP CONSTRAINT shipment_charges_unit_check,
  ADD CONSTRAINT shipment_charges_unit_check
    CHECK (unit IN ('container','kg','cbm','unit','flat','day'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Tipo de cargo: almacenaje con unidad correcta 'day'
--    Ya existe en el seed de 0018 con default_unit='flat'; actualizamos.
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.charge_types (code, name, default_unit, taxable_default, notes)
VALUES ('almacenaje', 'Almacenaje', 'day', false, 'Estadía en bodega de terceros')
ON CONFLICT (code) DO UPDATE SET
  default_unit = 'day',
  taxable_default = false,
  notes = 'Estadía en bodega de terceros';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. storage_stays — estadías de almacenaje
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.storage_stays (
  id                   uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid     NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  shipment_id          uuid     NOT NULL REFERENCES public.shipments(id)  ON DELETE CASCADE,
  provider_account_id  uuid     REFERENCES public.accounts(id)           ON DELETE RESTRICT,
  location_note        text,
  in_date              date     NOT NULL,
  out_date             date,
  free_days            integer  NOT NULL DEFAULT 0 CHECK (free_days >= 0),
  sell_rate_per_day    numeric(14,4) NOT NULL DEFAULT 0 CHECK (sell_rate_per_day >= 0),
  currency             char(3)  NOT NULL DEFAULT 'USD',
  notes                text,
  status               text     NOT NULL DEFAULT 'stored'
                         CHECK (status IN ('stored','released')),
  -- charge_id apunta al shipment_charge generado; NULL = aún no generado.
  -- ON DELETE SET NULL: si se elimina el cargo, la estadía puede generar uno nuevo.
  charge_id            uuid     REFERENCES public.shipment_charges(id) ON DELETE SET NULL,
  created_by           uuid     NOT NULL REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ss_out_after_in CHECK (out_date IS NULL OR out_date >= in_date),
  CONSTRAINT ss_released_has_out CHECK (
    status = 'stored' OR (status = 'released' AND out_date IS NOT NULL)
  )
);

CREATE INDEX ss_shipment_idx ON public.storage_stays (tenant_id, shipment_id, in_date DESC);
CREATE INDEX ss_status_idx   ON public.storage_stays (tenant_id, status);
CREATE INDEX ss_charge_idx   ON public.storage_stays (tenant_id, charge_id);

CREATE TRIGGER ss_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.storage_stays
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

CREATE TRIGGER ss_updated
  BEFORE UPDATE ON public.storage_stays
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER ss_lock_tid
  BEFORE UPDATE ON public.storage_stays
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.storage_stays ENABLE ROW LEVEL SECURITY;

CREATE POLICY ss_sel ON public.storage_stays FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY ss_ins ON public.storage_stays FOR INSERT TO authenticated
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY ss_upd ON public.storage_stays FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin','manager']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY ss_del ON public.storage_stays FOR DELETE TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. storage_stay_costs — costos internos (1:1 opcional)
--    Mismo patrón que shipment_charge_costs (migración 0018).
--    RLS exige can_see_costs = true para SELECT e INSERT/UPDATE.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.storage_stay_costs (
  stay_id              uuid     PRIMARY KEY REFERENCES public.storage_stays(id) ON DELETE CASCADE,
  tenant_id            uuid     NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cost_rate_per_day    numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_rate_per_day >= 0),
  vendor_invoice_ref   text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid     REFERENCES auth.users(id)
);

CREATE INDEX ssc_tenant_idx ON public.storage_stay_costs (tenant_id);

CREATE TRIGGER ssc_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.storage_stay_costs
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

CREATE TRIGGER ssc_updated
  BEFORE UPDATE ON public.storage_stay_costs
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER ssc_lock_tid
  BEFORE UPDATE ON public.storage_stay_costs
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.storage_stay_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ssc_sel ON public.storage_stay_costs FOR SELECT TO authenticated
  USING (
    private.is_member(tenant_id)
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = storage_stay_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );

CREATE POLICY ssc_ins ON public.storage_stay_costs FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(tenant_id,
      ARRAY['owner','admin','manager']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = storage_stay_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );

CREATE POLICY ssc_upd ON public.storage_stay_costs FOR UPDATE TO authenticated
  USING (
    private.has_role(tenant_id,
      ARRAY['owner','admin','manager']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = storage_stay_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  )
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY ssc_del ON public.storage_stay_costs FOR DELETE TO authenticated
  USING (
    private.has_role(tenant_id,
      ARRAY['owner','admin']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = storage_stay_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );
