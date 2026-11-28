-- 0026_client_enhancements.sql
-- AJ1: Mejoras a cuentas/clientes.
-- Contenido:
--   1. ADD credit_days a accounts (0=contado, 15, 21, 30 días)
--   2. ADD tax_id_type a accounts (RNC, RUT, Tax ID, ID, VAT)
--   3. Función validate_rnc + trigger para validar RNC dominicano (9 u 11 dígitos)
--   4. Tabla account_contacts — contactos por cuenta, con is_primary
--   5. RLS en account_contacts

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ADD credit_days a accounts
--    0 = contado. CHECK permite solo los valores definidos por el cliente.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.accounts
  ADD COLUMN credit_days smallint NOT NULL DEFAULT 0
    CHECK (credit_days IN (0, 15, 21, 30));

COMMENT ON COLUMN public.accounts.credit_days IS
  '0=contado, 15=15 días crédito, 21=21 días crédito, 30=30 días crédito';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. ADD tax_id_type a accounts
--    Opcional. Si se llena junto con tax_id, se valida el formato.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.accounts
  ADD COLUMN tax_id_type text
    CHECK (tax_id_type IN ('RNC', 'RUT', 'Tax ID', 'ID', 'VAT'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Validación de RNC dominicano
--    RNC: exactamente 9 u 11 dígitos numéricos.
--    La validación solo aplica cuando tax_id_type = 'RNC' y tax_id IS NOT NULL.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION private.validate_rnc(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT value ~ '^\d{9}$' OR value ~ '^\d{11}$';
$$;

CREATE OR REPLACE FUNCTION private.check_tax_id_format()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tax_id_type = 'RNC' AND NEW.tax_id IS NOT NULL AND NEW.tax_id != '' THEN
    IF NOT private.validate_rnc(NEW.tax_id) THEN
      RAISE EXCEPTION 'rnc_invalido: el RNC debe tener 9 u 11 dígitos';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_check_tax_id
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION private.check_tax_id_format();

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Tabla account_contacts — contactos de una cuenta
--    Un solo is_primary=true por account (enforced por índice parcial).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.account_contacts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id  uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  email       text,
  phone       text,
  role_label  text,
  is_primary  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ac_account_idx ON public.account_contacts (account_id);
CREATE INDEX ac_tenant_idx  ON public.account_contacts (tenant_id);

-- Solo un contacto principal por cuenta
CREATE UNIQUE INDEX ac_primary_unique_idx
  ON public.account_contacts (account_id)
  WHERE is_primary = true;

CREATE TRIGGER ac_updated
  BEFORE UPDATE ON public.account_contacts
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER ac_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.account_contacts
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

CREATE TRIGGER ac_lock_tid
  BEFORE UPDATE ON public.account_contacts
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RLS en account_contacts
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.account_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ac_sel ON public.account_contacts FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY ac_ins ON public.account_contacts FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','finance','sales','customs_broker']::public.tenant_role[]));

CREATE POLICY ac_upd ON public.account_contacts FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','finance','sales','customs_broker']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY ac_del ON public.account_contacts FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

REVOKE ALL ON TABLE public.account_contacts FROM anon;
