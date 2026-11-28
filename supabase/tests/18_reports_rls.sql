-- 18_reports_rls.sql
-- Test: Seguridad de las 4 vistas de reportes (Fase I).
-- T1: Aislamiento multi-tenant en las 4 vistas
-- T2: can_see_costs=false → costo=0 en report_rentabilidad (structural + data)
-- T3: anon no puede SELECT en ninguna vista
-- T4: las 4 vistas existen en information_schema.views

BEGIN;
SET LOCAL session_replication_role = 'replica';

-- ── Fixtures ──────────────────────────────────────────────────────────────────

-- Dos tenants
INSERT INTO public.tenants (id, name, slug, country, status)
VALUES
  ('eeee0001-0000-0000-0000-000000000001', 'Tenant Alfa', 'talfa', 'DO', 'active'),
  ('eeee0001-0000-0000-0000-000000000002', 'Tenant Beta', 'tbeta', 'DO', 'active')
ON CONFLICT DO NOTHING;

-- Tres usuarios auth
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('eeee0002-0000-0000-0000-000000000001', 'owner_a@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated'),
  ('eeee0002-0000-0000-0000-000000000002', 'op_a@test.com',    'x', NOW(), '{}', '{}', 'authenticated', 'authenticated'),
  ('eeee0002-0000-0000-0000-000000000003', 'owner_b@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, full_name)
VALUES
  ('eeee0002-0000-0000-0000-000000000001', 'Owner A'),
  ('eeee0002-0000-0000-0000-000000000002', 'Operador A'),
  ('eeee0002-0000-0000-0000-000000000003', 'Owner B')
ON CONFLICT DO NOTHING;

-- Membresías: owner_a con can_see_costs, op_a sin can_see_costs; owner_b en tenant B
INSERT INTO public.memberships (id, tenant_id, user_id, role, is_active, can_see_costs)
VALUES
  ('eeee0003-0000-0000-0000-000000000001', 'eeee0001-0000-0000-0000-000000000001', 'eeee0002-0000-0000-0000-000000000001', 'owner',    true, true),
  ('eeee0003-0000-0000-0000-000000000002', 'eeee0001-0000-0000-0000-000000000001', 'eeee0002-0000-0000-0000-000000000002', 'operator', true, false),
  ('eeee0003-0000-0000-0000-000000000003', 'eeee0001-0000-0000-0000-000000000002', 'eeee0002-0000-0000-0000-000000000003', 'owner',    true, true)
ON CONFLICT DO NOTHING;

-- Accounts: 1 cliente y 1 carrier por tenant
INSERT INTO public.accounts (id, tenant_id, kind, name)
VALUES
  ('eeee0004-0000-0000-0000-000000000001', 'eeee0001-0000-0000-0000-000000000001', 'customer', 'Cliente Alfa'),
  ('eeee0004-0000-0000-0000-000000000002', 'eeee0001-0000-0000-0000-000000000002', 'customer', 'Cliente Beta')
ON CONFLICT DO NOTHING;

-- Embarques: 1 por tenant
INSERT INTO public.shipments (id, tenant_id, number, account_id, stage_key, service_type,
  eta, ata, created_at)
VALUES
  ('eeee0005-0000-0000-0000-000000000001', 'eeee0001-0000-0000-0000-000000000001', 'ALF-001', 'eeee0004-0000-0000-0000-000000000001', 'delivered', 'mar_import', '2026-10-15', '2026-10-20', '2026-10-01 00:00:00+00'),
  ('eeee0005-0000-0000-0000-000000000002', 'eeee0001-0000-0000-0000-000000000002', 'BET-001', 'eeee0004-0000-0000-0000-000000000002', 'booked',    'mar_export', NULL,         NULL,         '2026-10-01 00:00:00+00')
ON CONFLICT DO NOTHING;

-- Cargo de venta (embarque de Alfa)
INSERT INTO public.shipment_charges (id, tenant_id, shipment_id, charge_type_id, description, quantity, unit, unit_price, currency, tax_rate)
VALUES
  ('eeee0006-0000-0000-0000-000000000001', 'eeee0001-0000-0000-0000-000000000001', 'eeee0005-0000-0000-0000-000000000001', 'flete', 'Flete demo', 1, 'flat', 2000, 'USD', 0)
ON CONFLICT DO NOTHING;

-- Costo interno (solo visible con can_see_costs=true)
INSERT INTO public.shipment_charge_costs (shipment_charge_id, tenant_id, unit_cost, currency)
VALUES
  ('eeee0006-0000-0000-0000-000000000001', 'eeee0001-0000-0000-0000-000000000001', 1500, 'USD')
ON CONFLICT DO NOTHING;

-- Cotización de Alfa
INSERT INTO public.quotes (id, tenant_id, number, account_id, service_type, status, currency, created_at)
VALUES
  ('eeee0007-0000-0000-0000-000000000001', 'eeee0001-0000-0000-0000-000000000001', 'ALF-COT-001', 'eeee0004-0000-0000-0000-000000000001', 'mar_import', 'sent', 'USD', '2026-10-01 00:00:00+00')
ON CONFLICT DO NOTHING;

-- ── T4 (estructural): las 4 vistas existen en information_schema.views ────────
DO $$
DECLARE missing_view text;
BEGIN
  FOR missing_view IN
    SELECT v.name FROM
      (VALUES
        ('report_embarques_por_mes'),
        ('report_puntualidad'),
        ('report_embudo'),
        ('report_rentabilidad')
      ) v(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = v.name
    )
  LOOP
    RAISE EXCEPTION 'T4 FAIL: vista "%" no existe en information_schema.views', missing_view;
  END LOOP;
  RAISE NOTICE 'T4 PASS: las 4 vistas de reportes existen';
END $$;

-- ── T2a (estructural): membership.can_see_costs existe como boolean con default false ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema  = 'public'
      AND table_name    = 'memberships'
      AND column_name   = 'can_see_costs'
      AND data_type     = 'boolean'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'T2a FAIL: memberships.can_see_costs no existe o no tiene default=false';
  END IF;
  RAISE NOTICE 'T2a PASS: memberships.can_see_costs es boolean con default false';
END $$;

-- ── T1: Aislamiento multi-tenant — owner_a solo ve datos de Tenant Alfa ───────
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'eeee0002-0000-0000-0000-000000000001', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;

  -- report_embarques_por_mes: solo filas de Tenant Alfa
  SELECT COUNT(*) INTO cnt FROM public.report_embarques_por_mes
  WHERE tenant_id = 'eeee0001-0000-0000-0000-000000000002';
  ASSERT cnt = 0, 'T1a FAIL: owner_a ve rows de Tenant Beta en report_embarques_por_mes, cnt=' || cnt;

  -- report_puntualidad: solo filas con ETA de Tenant Alfa
  SELECT COUNT(*) INTO cnt FROM public.report_puntualidad
  WHERE tenant_id = 'eeee0001-0000-0000-0000-000000000002';
  ASSERT cnt = 0, 'T1b FAIL: owner_a ve rows de Tenant Beta en report_puntualidad, cnt=' || cnt;

  -- report_embudo: solo cotizaciones de Tenant Alfa
  SELECT COUNT(*) INTO cnt FROM public.report_embudo
  WHERE tenant_id = 'eeee0001-0000-0000-0000-000000000002';
  ASSERT cnt = 0, 'T1c FAIL: owner_a ve rows de Tenant Beta en report_embudo, cnt=' || cnt;

  -- report_rentabilidad: solo embarques de Tenant Alfa
  SELECT COUNT(*) INTO cnt FROM public.report_rentabilidad
  WHERE tenant_id = 'eeee0001-0000-0000-0000-000000000002';
  ASSERT cnt = 0, 'T1d FAIL: owner_a ve rows de Tenant Beta en report_rentabilidad, cnt=' || cnt;

  RAISE NOTICE 'T1 PASS: owner_a no ve datos de Tenant Beta en ninguna vista de reporte';
END $$;

SET LOCAL session_replication_role = 'replica';

-- ── T2b: can_see_costs=false → costo=0 en report_rentabilidad ────────────────
DO $$
DECLARE v_costo numeric;
BEGIN
  -- op_a no tiene can_see_costs
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'eeee0002-0000-0000-0000-000000000002', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;

  SELECT costo INTO v_costo FROM public.report_rentabilidad
  WHERE shipment_id = 'eeee0005-0000-0000-0000-000000000001';

  ASSERT v_costo = 0 OR v_costo IS NULL,
    'T2b FAIL: op_a (sin can_see_costs) ve costo=' || COALESCE(v_costo::text, 'NULL') || ' (esperado 0)';
  RAISE NOTICE 'T2b PASS: op_a sin can_see_costs ve costo=0 en report_rentabilidad';
END $$;

SET LOCAL session_replication_role = 'replica';

-- ── T2c: can_see_costs=true → costo > 0 en report_rentabilidad ───────────────
DO $$
DECLARE v_costo numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'eeee0002-0000-0000-0000-000000000001', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;

  SELECT costo INTO v_costo FROM public.report_rentabilidad
  WHERE shipment_id = 'eeee0005-0000-0000-0000-000000000001';

  ASSERT v_costo > 0,
    'T2c FAIL: owner_a (con can_see_costs) ve costo=' || COALESCE(v_costo::text, 'NULL') || ' (esperado > 0)';
  RAISE NOTICE 'T2c PASS: owner_a con can_see_costs ve costo real en report_rentabilidad';
END $$;

SET LOCAL session_replication_role = 'replica';

-- ── T3: anon no puede SELECT en ninguna vista de reporte ─────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN (
        'report_embarques_por_mes',
        'report_puntualidad',
        'report_embudo',
        'report_rentabilidad'
      )
      AND grantee = 'anon'
      AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'T3 FAIL: anon tiene SELECT en alguna vista de reporte';
  END IF;
  RAISE NOTICE 'T3 PASS: anon no tiene SELECT en ninguna vista de reporte';
END $$;

ROLLBACK;

SELECT '18_reports_rls: OK' AS resultado;
