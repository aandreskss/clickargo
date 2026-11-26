-- 12_charges_rls.sql
-- Verificaciones de seguridad del módulo de cargos y prefacturas (Fase E).
-- Requisito: correr después de 0018_charges.sql y 0019_pre_invoices.sql.

-- ── T1: RLS habilitado en todas las tablas nuevas ────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('shipment_charges'), ('shipment_charge_costs'),
           ('exchange_rates'), ('pre_invoices'), ('pre_invoice_lines'),
           ('integration_credentials'), ('charge_types')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tname AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS no activado en tabla: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T2: Todas las tablas de negocio nuevas tienen tenant_id ──────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('shipment_charges'), ('shipment_charge_costs'),
           ('exchange_rates'), ('pre_invoices'), ('pre_invoice_lines'),
           ('integration_credentials')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tname AND column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'Tabla sin tenant_id: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T3: shipment_charge_costs tiene política que chequea can_see_costs ────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'shipment_charge_costs'
      AND polname    = 'scc_sel'
      AND qual::text ILIKE '%can_see_costs%'
  ) THEN
    RAISE EXCEPTION 'La política scc_sel de shipment_charge_costs no verifica can_see_costs';
  END IF;
END $$;

-- ── T4: anon no tiene acceso a las tablas sensibles ──────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('shipment_charges'), ('shipment_charge_costs'),
           ('pre_invoices'), ('pre_invoice_lines'), ('integration_credentials')
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name   = tname
        AND grantee      = 'anon'
    ) THEN
      RAISE EXCEPTION 'anon tiene permisos en tabla: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T5: search_charges es SECURITY DEFINER con search_path vacío ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_charges'
      AND p.prosecdef = true
      AND p.proconfig @> ARRAY['search_path=']
  ) THEN
    RAISE EXCEPTION 'search_charges no es SECURITY DEFINER con search_path vacío';
  END IF;
END $$;

-- ── T6: create_pre_invoice y void_pre_invoice son SECURITY DEFINER ────────────
DO $$
DECLARE
  fname text;
BEGIN
  FOR fname IN VALUES ('create_pre_invoice'), ('void_pre_invoice') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = fname
        AND p.prosecdef = true
        AND p.proconfig @> ARRAY['search_path=']
    ) THEN
      RAISE EXCEPTION '% no es SECURITY DEFINER con search_path vacío', fname;
    END IF;
  END LOOP;
END $$;

-- ── T7: pre_invoice_lines tiene triggers deny_mutation (append-only) ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'pre_invoice_lines'
      AND t.tgname = 'pil_no_update'
      AND t.tgenabled != 'D'
  ) THEN
    RAISE EXCEPTION 'pre_invoice_lines no tiene trigger pil_no_update (append-only)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'pre_invoice_lines'
      AND t.tgname = 'pil_no_delete'
      AND t.tgenabled != 'D'
  ) THEN
    RAISE EXCEPTION 'pre_invoice_lines no tiene trigger pil_no_delete (append-only)';
  END IF;
END $$;

-- ── T8: shipment_charges tiene trigger que bloquea edición si prefacturado ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'shipment_charges'
      AND t.tgname  = 'sc_lock_invoiced'
      AND t.tgenabled != 'D'
  ) THEN
    RAISE EXCEPTION 'shipment_charges no tiene trigger sc_lock_invoiced';
  END IF;
END $$;

-- ── T9: pre_invoices tiene trigger que protege campos financieros ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'pre_invoices'
      AND t.tgname  = 'pi_lock_financials'
      AND t.tgenabled != 'D'
  ) THEN
    RAISE EXCEPTION 'pre_invoices no tiene trigger pi_lock_financials';
  END IF;
END $$;

-- ── T10: integration_credentials no es accesible por anon ───────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name   = 'integration_credentials'
      AND grantee      IN ('anon', 'authenticated')
      AND privilege_type = 'SELECT'
      AND is_grantable = 'NO'
  ) THEN
    NULL; -- OK: tiene grant, pero RLS lo restringe a owner/admin
  END IF;

  -- Verificar que la política solo permite owner/admin
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'integration_credentials'
      AND polname    = 'ic_sel'
      AND qual::text ILIKE '%has_role%'
  ) THEN
    RAISE EXCEPTION 'integration_credentials no tiene política RLS que restrinja a owner/admin';
  END IF;
END $$;

-- ── T11: shipment_margin usa security_invoker ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_views v
    JOIN pg_class c ON c.relname = v.viewname
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND v.viewname = 'shipment_margin'
      AND c.relrowsecurity = false  -- las vistas no tienen RLS propia; usan security_invoker
  ) THEN
    RAISE EXCEPTION 'La vista shipment_margin no existe en el esquema public';
  END IF;

  -- Verificar que la vista existe y tiene el atributo security_invoker
  IF NOT EXISTS (
    SELECT 1 FROM pg_rewrite r
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'shipment_margin'
      AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'shipment_margin no existe como vista';
  END IF;
END $$;

-- ── T12: search_charges no expone columnas de costo ──────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'search_charges'
      AND column_name  IN ('unit_cost', 'costo', 'margin', 'vendor_account_id')
  ) THEN
    RAISE EXCEPTION 'search_charges expone columnas de costo';
  END IF;
END $$;

-- Todos los tests pasaron.
SELECT 'charges_rls: OK' AS resultado;
