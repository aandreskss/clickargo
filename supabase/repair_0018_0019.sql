-- ════════════════════════════════════════════════════════════════════════════════
-- repair_0018_0019.sql
-- Script de reparación idempotente: cubre migraciones 0018 (Cargos) + 0019 (Prefacturas).
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- Es seguro volver a correr si falla a la mitad.
-- ════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────
-- TRANSICIÓN 1: charge_types
-- 0014 creó una versión per-empresa (con tenant_id, PK uuid).
-- 0018 la rediseña como catálogo global (sin tenant_id, PK text code).
-- Ninguna FK apunta a la tabla antigua, así que el DROP es seguro.
-- ────────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.seed_default_charge_types(uuid);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'charge_types' AND column_name = 'tenant_id'
  ) THEN
    EXECUTE 'DROP TABLE public.charge_types CASCADE';
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────────
-- TRANSICIÓN 2: integration_credentials
-- 0010 tenía columna secret_enc (diseño simple).
-- 0019 la reemplaza con encrypted_payload + iv + auth_tag (AES-256-GCM).
-- ────────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'integration_credentials' AND column_name = 'secret_enc'
  ) THEN
    EXECUTE 'DROP TABLE public.integration_credentials CASCADE';
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 0018: Cargos de embarque
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. charge_types (catálogo global) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.charge_types (
  code             text        PRIMARY KEY,
  name             text        NOT NULL,
  default_unit     text        NOT NULL CHECK (default_unit IN ('container','kg','cbm','unit','flat')),
  taxable_default  boolean     NOT NULL DEFAULT false,
  notes            text
);

INSERT INTO public.charge_types (code, name, default_unit, taxable_default) VALUES
  ('flete',            'Flete marítimo/aéreo',   'container', false),
  ('thc_origen',       'THC origen',              'container', false),
  ('thc_destino',      'THC destino',             'container', false),
  ('bl_fee',           'Tarifa B/L',              'flat',      false),
  ('aduana',           'Servicio aduanal',         'flat',      true),
  ('almacenaje',       'Almacenaje',              'flat',      true),
  ('isps',             'Cargo ISPS',              'container', false),
  ('desconsolidacion', 'Desconsolidación',        'container', true),
  ('courier',          'Mensajería / courier',    'flat',      true),
  ('seguro',           'Seguro de carga',         'flat',      false),
  ('inspeccion',       'Inspección',              'flat',      true),
  ('demurrage',        'Demurrage',               'container', false),
  ('detention',        'Detention',               'container', false),
  ('otro',             'Otro cargo',              'flat',      false)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.charge_types ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'charge_types' AND policyname = 'charge_types_sel'
  ) THEN
    CREATE POLICY charge_types_sel ON public.charge_types FOR SELECT TO authenticated USING (true);
  END IF;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.charge_types FROM authenticated;

-- ── 2. exchange_rates ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  effective_date  date          NOT NULL,
  usd_to_dop      numeric(10,4) NOT NULL CHECK (usd_to_dop > 0),
  source          text,
  created_by      uuid          DEFAULT auth.uid(),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, effective_date)
);

CREATE INDEX IF NOT EXISTS exchange_rates_tenant_idx ON public.exchange_rates (tenant_id, effective_date DESC);

DROP TRIGGER IF EXISTS exchange_rates_audit    ON public.exchange_rates;
DROP TRIGGER IF EXISTS exchange_rates_updated  ON public.exchange_rates;
DROP TRIGGER IF EXISTS exchange_rates_lock_tid ON public.exchange_rates;
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='exchange_rates' AND policyname='exchange_rates_sel') THEN
    CREATE POLICY exchange_rates_sel ON public.exchange_rates FOR SELECT TO authenticated
      USING (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='exchange_rates' AND policyname='exchange_rates_ins') THEN
    CREATE POLICY exchange_rates_ins ON public.exchange_rates FOR INSERT TO authenticated
      WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin','finance']::public.tenant_role[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='exchange_rates' AND policyname='exchange_rates_upd') THEN
    CREATE POLICY exchange_rates_upd ON public.exchange_rates FOR UPDATE TO authenticated
      USING  (private.has_role(tenant_id, ARRAY['owner','admin','finance']::public.tenant_role[]))
      WITH CHECK (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='exchange_rates' AND policyname='exchange_rates_del') THEN
    CREATE POLICY exchange_rates_del ON public.exchange_rates FOR DELETE TO authenticated
      USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));
  END IF;
END;
$$;

-- ── 3. shipment_charges ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shipment_charges (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  shipment_id        uuid          NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  charge_type_id     text          NOT NULL REFERENCES public.charge_types(code),
  description        text          NOT NULL,
  quantity           numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit               text          NOT NULL CHECK (unit IN ('container','kg','cbm','unit','flat')),
  unit_price         numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  currency           char(3)       NOT NULL DEFAULT 'USD',
  tax_rate           numeric(5,4)  NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  bill_to_account_id uuid          REFERENCES public.accounts(id) ON DELETE SET NULL,
  pre_invoice_id     uuid,
  sort_order         int           NOT NULL DEFAULT 0,
  created_by         uuid          DEFAULT auth.uid(),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sc_shipment_idx    ON public.shipment_charges (shipment_id, sort_order);
CREATE INDEX IF NOT EXISTS sc_tenant_idx      ON public.shipment_charges (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sc_preinvoice_idx  ON public.shipment_charges (pre_invoice_id) WHERE pre_invoice_id IS NOT NULL;

DROP TRIGGER IF EXISTS sc_audit          ON public.shipment_charges;
DROP TRIGGER IF EXISTS sc_updated        ON public.shipment_charges;
DROP TRIGGER IF EXISTS sc_lock_tid       ON public.shipment_charges;
DROP TRIGGER IF EXISTS sc_lock_invoiced  ON public.shipment_charges;

CREATE TRIGGER sc_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipment_charges
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER sc_updated
  BEFORE UPDATE ON public.shipment_charges
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER sc_lock_tid
  BEFORE UPDATE ON public.shipment_charges
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

CREATE OR REPLACE FUNCTION private.sc_lock_invoiced()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.pre_invoice_id IS NOT NULL THEN
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charges' AND policyname='sc_sel') THEN
    CREATE POLICY sc_sel ON public.shipment_charges FOR SELECT TO authenticated
      USING (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charges' AND policyname='sc_ins') THEN
    CREATE POLICY sc_ins ON public.shipment_charges FOR INSERT TO authenticated
      WITH CHECK (private.has_role(tenant_id,
        ARRAY['owner','admin','manager','finance']::public.tenant_role[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charges' AND policyname='sc_upd') THEN
    CREATE POLICY sc_upd ON public.shipment_charges FOR UPDATE TO authenticated
      USING  (private.has_role(tenant_id, ARRAY['owner','admin','manager','finance']::public.tenant_role[]))
      WITH CHECK (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charges' AND policyname='sc_del') THEN
    CREATE POLICY sc_del ON public.shipment_charges FOR DELETE TO authenticated
      USING (
        private.has_role(tenant_id, ARRAY['owner','admin','manager']::public.tenant_role[])
        AND pre_invoice_id IS NULL
      );
  END IF;
END;
$$;

-- ── 4. shipment_charge_costs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shipment_charge_costs (
  shipment_charge_id uuid          PRIMARY KEY REFERENCES public.shipment_charges(id) ON DELETE CASCADE,
  tenant_id          uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vendor_account_id  uuid          REFERENCES public.accounts(id) ON DELETE SET NULL,
  unit_cost          numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  currency           char(3)       NOT NULL DEFAULT 'USD',
  vendor_invoice_ref text,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scc_tenant_idx ON public.shipment_charge_costs (tenant_id);

DROP TRIGGER IF EXISTS scc_audit    ON public.shipment_charge_costs;
DROP TRIGGER IF EXISTS scc_updated  ON public.shipment_charge_costs;
DROP TRIGGER IF EXISTS scc_lock_tid ON public.shipment_charge_costs;
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charge_costs' AND policyname='scc_sel') THEN
    CREATE POLICY scc_sel ON public.shipment_charge_costs FOR SELECT TO authenticated
      USING (
        private.is_member(tenant_id)
        AND (SELECT m.can_see_costs FROM public.memberships m
             WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()) = true
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charge_costs' AND policyname='scc_ins') THEN
    CREATE POLICY scc_ins ON public.shipment_charge_costs FOR INSERT TO authenticated
      WITH CHECK (
        private.has_role(tenant_id, ARRAY['owner','admin','finance']::public.tenant_role[])
        AND (SELECT m.can_see_costs FROM public.memberships m
             WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()) = true
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charge_costs' AND policyname='scc_upd') THEN
    CREATE POLICY scc_upd ON public.shipment_charge_costs FOR UPDATE TO authenticated
      USING (
        private.has_role(tenant_id, ARRAY['owner','admin','finance']::public.tenant_role[])
        AND (SELECT m.can_see_costs FROM public.memberships m
             WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()) = true
      )
      WITH CHECK (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shipment_charge_costs' AND policyname='scc_del') THEN
    CREATE POLICY scc_del ON public.shipment_charge_costs FOR DELETE TO authenticated
      USING (
        private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[])
        AND (SELECT m.can_see_costs FROM public.memberships m
             WHERE m.tenant_id = shipment_charge_costs.tenant_id AND m.user_id = auth.uid()) = true
      );
  END IF;
END;
$$;

-- ── 5. Vista shipment_margin ────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.shipment_margin;

CREATE VIEW public.shipment_margin WITH (security_invoker = true) AS
SELECT
  sc.shipment_id,
  sc.tenant_id,
  sc.currency,
  ROUND(SUM(sc.quantity * sc.unit_price)::numeric, 2)                                   AS venta,
  ROUND(SUM(sc.quantity * sc.unit_price * sc.tax_rate)::numeric, 2)                     AS tax_venta,
  ROUND(COALESCE(SUM(scc.unit_cost * sc.quantity), 0)::numeric, 2)                      AS costo,
  ROUND((SUM(sc.quantity * sc.unit_price)
         - COALESCE(SUM(scc.unit_cost * sc.quantity), 0))::numeric, 2)                  AS margen,
  CASE
    WHEN SUM(sc.quantity * sc.unit_price) > 0
    THEN ROUND(
      ((SUM(sc.quantity * sc.unit_price) - COALESCE(SUM(scc.unit_cost * sc.quantity), 0))
       / SUM(sc.quantity * sc.unit_price) * 100)::numeric, 2)
    ELSE 0
  END                                                                                     AS margen_pct
FROM public.shipment_charges sc
LEFT JOIN public.shipment_charge_costs scc ON scc.shipment_charge_id = sc.id
GROUP BY sc.shipment_id, sc.tenant_id, sc.currency;

-- ── 6. RPC search_charges ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.search_charges(uuid, uuid);

CREATE OR REPLACE FUNCTION public.search_charges(_tenant uuid, _shipment uuid)
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
  SELECT sc.id, sc.charge_type_id, ct.name, sc.description, sc.quantity, sc.unit,
         sc.unit_price, sc.currency, sc.tax_rate, sc.bill_to_account_id,
         sc.pre_invoice_id, sc.sort_order, sc.created_at
  FROM public.shipment_charges sc
  JOIN public.charge_types ct ON ct.code = sc.charge_type_id
  WHERE sc.tenant_id = _tenant AND sc.shipment_id = _shipment
  ORDER BY sc.sort_order, sc.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_charges(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_charges(uuid, uuid) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════════
-- 0019: Prefacturas
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. pre_invoices ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pre_invoices (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number           text          NOT NULL,
  account_id       uuid          NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  status           text          NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','ready','sent_to_erp','invoiced','void')),
  currency         char(3)       NOT NULL DEFAULT 'USD',
  subtotal         numeric(14,2) NOT NULL DEFAULT 0,
  tax_total        numeric(14,2) NOT NULL DEFAULT 0,
  total            numeric(14,2) NOT NULL DEFAULT 0,
  exchange_rate    numeric(10,4),
  notes            text,
  erp_provider     text,
  erp_document_ref text,
  sent_at          timestamptz,
  created_by       uuid          DEFAULT auth.uid(),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE INDEX IF NOT EXISTS pi_tenant_idx  ON public.pre_invoices (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pi_account_idx ON public.pre_invoices (tenant_id, account_id);
CREATE INDEX IF NOT EXISTS pi_status_idx  ON public.pre_invoices (tenant_id, status);

DROP TRIGGER IF EXISTS pi_audit           ON public.pre_invoices;
DROP TRIGGER IF EXISTS pi_updated         ON public.pre_invoices;
DROP TRIGGER IF EXISTS pi_lock_tid        ON public.pre_invoices;
DROP TRIGGER IF EXISTS pi_lock_financials ON public.pre_invoices;

CREATE TRIGGER pi_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER pi_updated
  BEFORE UPDATE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER pi_lock_tid
  BEFORE UPDATE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

CREATE OR REPLACE FUNCTION private.pi_lock_financials()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status != 'draft' AND OLD.status != 'void' THEN
    IF (NEW.subtotal, NEW.tax_total, NEW.total, NEW.currency, NEW.account_id)
       IS DISTINCT FROM
       (OLD.subtotal, OLD.tax_total, OLD.total, OLD.currency, OLD.account_id)
    THEN
      RAISE EXCEPTION 'prefactura_no_editable: los montos de una prefactura confirmada son inmutables';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pi_lock_financials
  BEFORE UPDATE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.pi_lock_financials();

ALTER TABLE public.pre_invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pre_invoices' AND policyname='pi_sel') THEN
    CREATE POLICY pi_sel ON public.pre_invoices FOR SELECT TO authenticated
      USING (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pre_invoices' AND policyname='pi_ins') THEN
    CREATE POLICY pi_ins ON public.pre_invoices FOR INSERT TO authenticated
      WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin','finance']::public.tenant_role[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pre_invoices' AND policyname='pi_upd') THEN
    CREATE POLICY pi_upd ON public.pre_invoices FOR UPDATE TO authenticated
      USING  (private.has_role(tenant_id, ARRAY['owner','admin','finance']::public.tenant_role[]))
      WITH CHECK (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pre_invoices' AND policyname='pi_del') THEN
    CREATE POLICY pi_del ON public.pre_invoices FOR DELETE TO authenticated
      USING (
        private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[])
        AND status = 'void'
      );
  END IF;
END;
$$;

-- ── 2. FK circular shipment_charges.pre_invoice_id → pre_invoices ───────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sc_pre_invoice_fkey' AND table_schema = 'public' AND table_name = 'shipment_charges'
  ) THEN
    ALTER TABLE public.shipment_charges
      ADD CONSTRAINT sc_pre_invoice_fkey
      FOREIGN KEY (pre_invoice_id)
      REFERENCES public.pre_invoices(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- ── 3. pre_invoice_lines (snapshot append-only) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pre_invoice_lines (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_invoice_id     uuid          NOT NULL REFERENCES public.pre_invoices(id) ON DELETE CASCADE,
  tenant_id          uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_charge_id uuid,
  shipment_id        uuid,
  charge_type_code   text          NOT NULL,
  description        text          NOT NULL,
  quantity           numeric(12,3) NOT NULL,
  unit               text          NOT NULL,
  unit_price         numeric(14,2) NOT NULL,
  currency           char(3)       NOT NULL,
  tax_rate           numeric(5,4)  NOT NULL,
  subtotal           numeric(14,2) NOT NULL,
  tax_amount         numeric(14,2) NOT NULL,
  total              numeric(14,2) NOT NULL,
  sort_order         int           NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS pil_preinvoice_idx ON public.pre_invoice_lines (pre_invoice_id);

DROP TRIGGER IF EXISTS pil_no_update ON public.pre_invoice_lines;
DROP TRIGGER IF EXISTS pil_no_delete ON public.pre_invoice_lines;
CREATE TRIGGER pil_no_update
  BEFORE UPDATE ON public.pre_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();
CREATE TRIGGER pil_no_delete
  BEFORE DELETE ON public.pre_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

ALTER TABLE public.pre_invoice_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pre_invoice_lines' AND policyname='pil_sel') THEN
    CREATE POLICY pil_sel ON public.pre_invoice_lines FOR SELECT TO authenticated
      USING (private.is_member(tenant_id));
  END IF;
END;
$$;

-- ── 4. integration_credentials (AES-256-GCM) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.integration_credentials (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider          text          NOT NULL,
  encrypted_payload text          NOT NULL,
  iv                text          NOT NULL,
  auth_tag          text          NOT NULL,
  masked_display    text          NOT NULL,
  last_accessed_at  timestamptz,
  created_by        uuid          DEFAULT auth.uid(),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS ic_tenant_idx ON public.integration_credentials (tenant_id);

DROP TRIGGER IF EXISTS ic_audit    ON public.integration_credentials;
DROP TRIGGER IF EXISTS ic_updated  ON public.integration_credentials;
DROP TRIGGER IF EXISTS ic_lock_tid ON public.integration_credentials;
CREATE TRIGGER ic_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER ic_updated
  BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER ic_lock_tid
  BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='integration_credentials' AND policyname='ic_sel') THEN
    CREATE POLICY ic_sel ON public.integration_credentials FOR SELECT TO authenticated
      USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='integration_credentials' AND policyname='ic_ins') THEN
    CREATE POLICY ic_ins ON public.integration_credentials FOR INSERT TO authenticated
      WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='integration_credentials' AND policyname='ic_upd') THEN
    CREATE POLICY ic_upd ON public.integration_credentials FOR UPDATE TO authenticated
      USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
      WITH CHECK (private.is_member(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='integration_credentials' AND policyname='ic_del') THEN
    CREATE POLICY ic_del ON public.integration_credentials FOR DELETE TO authenticated
      USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));
  END IF;
END;
$$;

-- ── 5. RPC create_pre_invoice ────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.create_pre_invoice(uuid, uuid[], text, numeric);

CREATE OR REPLACE FUNCTION public.create_pre_invoice(
  _tenant          uuid,
  _charge_ids      uuid[],
  _notes           text    DEFAULT NULL,
  _exchange_rate   numeric DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pre_invoice_id  uuid;
  v_number          text;
  v_account_id      uuid;
  v_currency        char(3);
  v_subtotal        numeric(14,2) := 0;
  v_tax_total       numeric(14,2) := 0;
  v_total           numeric(14,2) := 0;
  v_charge          record;
  v_line_subtotal   numeric(14,2);
  v_line_tax        numeric(14,2);
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin','finance']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _charge_ids IS NULL OR array_length(_charge_ids, 1) = 0 THEN
    RAISE EXCEPTION 'cargos_obligatorios';
  END IF;
  SELECT DISTINCT sc.bill_to_account_id, sc.currency
    INTO v_account_id, v_currency
  FROM public.shipment_charges sc
  WHERE sc.id = ANY(_charge_ids) AND sc.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'cargos_no_encontrados'; END IF;
  IF (SELECT COUNT(*) FROM public.shipment_charges
      WHERE id = ANY(_charge_ids) AND tenant_id = _tenant AND pre_invoice_id IS NULL
     ) != array_length(_charge_ids, 1)
  THEN
    RAISE EXCEPTION 'cargo_bloqueado_prefactura: uno o más cargos ya tienen prefactura asignada';
  END IF;
  v_number := public.next_number(_tenant, 'pre_invoices', 'PF-');
  INSERT INTO public.pre_invoices (
    tenant_id, number, account_id, status, currency,
    subtotal, tax_total, total, exchange_rate, notes, created_by
  ) VALUES (
    _tenant, v_number, v_account_id, 'draft', v_currency,
    0, 0, 0, _exchange_rate, _notes, auth.uid()
  )
  RETURNING id INTO v_pre_invoice_id;
  FOR v_charge IN
    SELECT sc.*, ct.code AS ct_code
    FROM public.shipment_charges sc
    JOIN public.charge_types ct ON ct.code = sc.charge_type_id
    WHERE sc.id = ANY(_charge_ids) AND sc.tenant_id = _tenant
    ORDER BY sc.sort_order, sc.created_at
  LOOP
    v_line_subtotal := ROUND((v_charge.quantity * v_charge.unit_price)::numeric, 2);
    v_line_tax      := ROUND((v_line_subtotal * v_charge.tax_rate)::numeric, 2);
    INSERT INTO public.pre_invoice_lines (
      pre_invoice_id, tenant_id,
      shipment_charge_id, shipment_id,
      charge_type_code, description,
      quantity, unit, unit_price, currency, tax_rate,
      subtotal, tax_amount, total, sort_order
    ) VALUES (
      v_pre_invoice_id, _tenant,
      v_charge.id, v_charge.shipment_id,
      v_charge.ct_code, v_charge.description,
      v_charge.quantity, v_charge.unit, v_charge.unit_price,
      v_charge.currency, v_charge.tax_rate,
      v_line_subtotal, v_line_tax,
      ROUND((v_line_subtotal + v_line_tax)::numeric, 2),
      v_charge.sort_order
    );
    v_subtotal  := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;
  v_total := ROUND((v_subtotal + v_tax_total)::numeric, 2);
  UPDATE public.pre_invoices
  SET subtotal = ROUND(v_subtotal, 2), tax_total = ROUND(v_tax_total, 2),
      total = v_total, status = 'ready'
  WHERE id = v_pre_invoice_id;
  UPDATE public.shipment_charges
  SET pre_invoice_id = v_pre_invoice_id
  WHERE id = ANY(_charge_ids) AND tenant_id = _tenant;
  RETURN v_pre_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_pre_invoice(uuid, uuid[], text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.create_pre_invoice(uuid, uuid[], text, numeric) TO authenticated;

-- ── 6. RPC void_pre_invoice ──────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.void_pre_invoice(uuid, uuid);

CREATE OR REPLACE FUNCTION public.void_pre_invoice(_tenant uuid, _pre_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_status text;
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT status INTO v_status
  FROM public.pre_invoices
  WHERE id = _pre_invoice_id AND tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefactura_no_encontrada'; END IF;
  IF v_status = 'invoiced' THEN
    RAISE EXCEPTION 'prefactura_no_editable: una prefactura ya facturada no puede anularse';
  END IF;
  IF v_status = 'void' THEN RAISE EXCEPTION 'prefactura_ya_anulada'; END IF;
  UPDATE public.shipment_charges
  SET pre_invoice_id = NULL
  WHERE pre_invoice_id = _pre_invoice_id AND tenant_id = _tenant;
  UPDATE public.pre_invoices SET status = 'void'
  WHERE id = _pre_invoice_id AND tenant_id = _tenant;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_pre_invoice(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.void_pre_invoice(uuid, uuid) TO authenticated;
