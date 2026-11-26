-- 0018_charges.sql
-- Fase E: Cargos, margen y tasa de cambio.
-- Contenido:
--   1. charge_types       — catálogo global (sin tenant_id; patrón ports/incoterms)
--   2. exchange_rates     — tasas DOP/USD por empresa y fecha
--   3. shipment_charges   — cargos de VENTA por embarque
--   4. shipment_charge_costs — costos internos (1:1 opcional; exige can_see_costs)
--   5. shipment_margin    — vista security_invoker para venta, costo y margen
--   6. RLS en todas las tablas
--   7. RPC search_charges — búsqueda segura de cargos de un embarque

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. charge_types (catálogo global)
--    Sin tenant_id — compartido entre todas las empresas, como ports e incoterms.
--    INSERT/UPDATE/DELETE reservados para administración de BD.
--    taxable_default: indicativo; Box To Go define qué cargos llevan ITBIS.
--    Ver docs/PREGUNTAS_OPERACION.md para los detalles pendientes.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.charge_types (
  code             text        PRIMARY KEY,
  name             text        NOT NULL,
  default_unit     text        NOT NULL CHECK (default_unit IN ('container','kg','cbm','unit','flat')),
  taxable_default  boolean     NOT NULL DEFAULT false,  -- pendiente confirmar con contabilidad
  notes            text
);

-- Seed básico — ajustar según lo que confirme Box To Go en PREGUNTAS_OPERACION.md
INSERT INTO public.charge_types (code, name, default_unit, taxable_default) VALUES
  ('flete',        'Flete marítimo/aéreo',       'container', false),
  ('thc_origen',   'THC origen',                 'container', false),
  ('thc_destino',  'THC destino',                'container', false),
  ('bl_fee',       'Tarifa B/L',                 'flat',      false),
  ('aduana',       'Servicio aduanal',            'flat',      true),
  ('almacenaje',   'Almacenaje',                 'flat',      true),
  ('isps',         'Cargo ISPS',                 'container', false),
  ('desconsolidacion', 'Desconsolidación',        'container', true),
  ('courier',      'Mensajería / courier',        'flat',      true),
  ('seguro',       'Seguro de carga',            'flat',      false),
  ('inspeccion',   'Inspección',                 'flat',      true),
  ('demurrage',    'Demurrage',                  'container', false),
  ('detention',    'Detention',                  'container', false),
  ('otro',         'Otro cargo',                 'flat',      false);

ALTER TABLE public.charge_types ENABLE ROW LEVEL SECURITY;

-- Solo lectura para todos los autenticados; escritura reservada a BD (superadmin)
CREATE POLICY charge_types_sel ON public.charge_types FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.charge_types FROM authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. exchange_rates — tasa de cambio DOP/USD por empresa y fecha
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.exchange_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  effective_date  date        NOT NULL,
  usd_to_dop      numeric(10,4) NOT NULL CHECK (usd_to_dop > 0),
  source          text,         -- 'bancentral', 'manual', etc.
  created_by      uuid        DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, effective_date)
);

CREATE INDEX exchange_rates_tenant_idx ON public.exchange_rates (tenant_id, effective_date DESC);

CREATE TRIGGER exchange_rates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER exchange_rates_updated
  BEFORE UPDATE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER exchange_rates_lock_tid
  BEFORE UPDATE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY exchange_rates_sel ON public.exchange_rates FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));
CREATE POLICY exchange_rates_ins ON public.exchange_rates FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','finance']::public.tenant_role[]));
CREATE POLICY exchange_rates_upd ON public.exchange_rates FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','finance']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));
CREATE POLICY exchange_rates_del ON public.exchange_rates FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]));

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. shipment_charges — cargos de VENTA por embarque
--    - Todo el equipo con rol adecuado puede ver (is_member), no exige can_see_costs.
--    - Los cargos prefacturados (pre_invoice_id NOT NULL) son inmutables:
--      el trigger sc_lock_invoiced lo hace cumplir.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipment_charges (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id        uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  charge_type_id     text        NOT NULL REFERENCES public.charge_types(code),
  description        text        NOT NULL,
  quantity           numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit               text        NOT NULL CHECK (unit IN ('container','kg','cbm','unit','flat')),
  unit_price         numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  currency           char(3)     NOT NULL DEFAULT 'USD',
  tax_rate           numeric(5,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  bill_to_account_id uuid        REFERENCES public.accounts(id) ON DELETE SET NULL,
  pre_invoice_id     uuid,       -- FK a pre_invoices; se agrega en 0019 (FK circular)
  sort_order         int         NOT NULL DEFAULT 0,
  created_by         uuid        DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sc_shipment_idx    ON public.shipment_charges (shipment_id, sort_order);
CREATE INDEX sc_tenant_idx      ON public.shipment_charges (tenant_id, created_at DESC);
CREATE INDEX sc_preinvoice_idx  ON public.shipment_charges (pre_invoice_id) WHERE pre_invoice_id IS NOT NULL;

CREATE TRIGGER sc_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipment_charges
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER sc_updated
  BEFORE UPDATE ON public.shipment_charges
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER sc_lock_tid
  BEFORE UPDATE ON public.shipment_charges
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- Protege cargos ya prefacturados: solo pre_invoice_id puede cambiar (lo asigna la RPC)
CREATE OR REPLACE FUNCTION private.sc_lock_invoiced()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.pre_invoice_id IS NOT NULL THEN
    -- Permitir solo actualizar pre_invoice_id (anulación libera con NULL)
    IF (NEW.charge_type_id, NEW.description, NEW.quantity, NEW.unit,
        NEW.unit_price, NEW.currency, NEW.tax_rate, NEW.bill_to_account_id)
       IS DISTINCT FROM
       (OLD.charge_type_id, OLD.description, OLD.quantity, OLD.unit,
        OLD.unit_price, OLD.currency, OLD.tax_rate, OLD.bill_to_account_id)
    THEN
      RAISE EXCEPTION 'cargo_bloqueado_prefactura: el cargo ya fue prefacturado y no puede editarse';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sc_lock_invoiced
  BEFORE UPDATE ON public.shipment_charges
  FOR EACH ROW EXECUTE FUNCTION private.sc_lock_invoiced();

ALTER TABLE public.shipment_charges ENABLE ROW LEVEL SECURITY;

-- SELECT: todo miembro del tenant (venta es información operativa, no sensible)
CREATE POLICY sc_sel ON public.shipment_charges FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

-- INSERT: roles con acceso a facturación
CREATE POLICY sc_ins ON public.shipment_charges FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','finance']::public.tenant_role[]));

-- UPDATE: mismo conjunto de roles; el trigger bloquea si pre_invoice_id IS NOT NULL
CREATE POLICY sc_upd ON public.shipment_charges FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','finance']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

-- DELETE: solo si sin prefactura
CREATE POLICY sc_del ON public.shipment_charges FOR DELETE TO authenticated
  USING (
    private.has_role(tenant_id,
      ARRAY['owner','admin','manager']::public.tenant_role[])
    AND pre_invoice_id IS NULL
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. shipment_charge_costs — costos internos (1:1 opcional con shipment_charges)
--    SEGURIDAD: exige can_see_costs = true. Patrón idéntico a quote_line_costs (0011).
--    Un cargo puede existir sin costo (reventa sin proveedor asignado) o sin venta
--    (gasto puro). La relación 1:1 es opcional.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipment_charge_costs (
  shipment_charge_id uuid        PRIMARY KEY REFERENCES public.shipment_charges(id) ON DELETE CASCADE,
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_account_id  uuid        REFERENCES public.accounts(id) ON DELETE SET NULL,
  unit_cost          numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  currency           char(3)     NOT NULL DEFAULT 'USD',
  vendor_invoice_ref text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scc_tenant_idx ON public.shipment_charge_costs (tenant_id);

CREATE TRIGGER scc_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipment_charge_costs
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER scc_updated
  BEFORE UPDATE ON public.shipment_charge_costs
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER scc_lock_tid
  BEFORE UPDATE ON public.shipment_charge_costs
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.shipment_charge_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY scc_sel ON public.shipment_charge_costs FOR SELECT TO authenticated
  USING (
    private.is_member(tenant_id)
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );

CREATE POLICY scc_ins ON public.shipment_charge_costs FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(tenant_id,
      ARRAY['owner','admin','finance']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );

CREATE POLICY scc_upd ON public.shipment_charge_costs FOR UPDATE TO authenticated
  USING (
    private.has_role(tenant_id,
      ARRAY['owner','admin','finance']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  )
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY scc_del ON public.shipment_charge_costs FOR DELETE TO authenticated
  USING (
    private.has_role(tenant_id,
      ARRAY['owner','admin']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. shipment_margin — vista security_invoker
--    Con security_invoker la RLS de shipment_charge_costs aplica al usuario
--    que ejecuta la query: si no tiene can_see_costs, el LEFT JOIN retorna NULL
--    y el margen nunca se calcula (siempre NULL para ese usuario).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE VIEW public.shipment_margin WITH (security_invoker = true) AS
SELECT
  sc.shipment_id,
  sc.tenant_id,
  sc.currency,
  ROUND(SUM(sc.quantity * sc.unit_price)::numeric, 2)                            AS venta,
  ROUND(SUM(sc.quantity * sc.unit_price * sc.tax_rate)::numeric, 2)              AS tax_venta,
  ROUND(COALESCE(SUM(scc.unit_cost * sc.quantity), 0)::numeric, 2)               AS costo,
  ROUND(
    (SUM(sc.quantity * sc.unit_price)
     - COALESCE(SUM(scc.unit_cost * sc.quantity), 0))::numeric,
  2)                                                                               AS margen,
  CASE
    WHEN SUM(sc.quantity * sc.unit_price) > 0
    THEN ROUND(
      ((SUM(sc.quantity * sc.unit_price)
        - COALESCE(SUM(scc.unit_cost * sc.quantity), 0))
       / SUM(sc.quantity * sc.unit_price) * 100)::numeric,
    2)
    ELSE 0
  END                                                                              AS margen_pct
FROM public.shipment_charges sc
LEFT JOIN public.shipment_charge_costs scc ON scc.shipment_charge_id = sc.id
GROUP BY sc.shipment_id, sc.tenant_id, sc.currency;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RPC search_charges
--    SECURITY DEFINER — no expone costos ni internal data.
--    Solo retorna cargos de VENTA del embarque indicado.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.search_charges(uuid, uuid);

CREATE OR REPLACE FUNCTION public.search_charges(
  _tenant     uuid,
  _shipment   uuid
)
RETURNS TABLE (
  id                 uuid,
  charge_type_id     text,
  charge_type_name   text,
  description        text,
  quantity           numeric,
  unit               text,
  unit_price         numeric,
  currency           char,
  tax_rate           numeric,
  bill_to_account_id uuid,
  pre_invoice_id     uuid,
  sort_order         int,
  created_at         timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_member(_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    sc.id,
    sc.charge_type_id,
    ct.name        AS charge_type_name,
    sc.description,
    sc.quantity,
    sc.unit,
    sc.unit_price,
    sc.currency,
    sc.tax_rate,
    sc.bill_to_account_id,
    sc.pre_invoice_id,
    sc.sort_order,
    sc.created_at
  FROM public.shipment_charges sc
  JOIN public.charge_types ct ON ct.code = sc.charge_type_id
  WHERE sc.tenant_id = _tenant
    AND sc.shipment_id = _shipment
  ORDER BY sc.sort_order, sc.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_charges(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_charges(uuid, uuid) TO authenticated;
