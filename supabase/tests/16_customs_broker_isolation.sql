-- 16_customs_broker_isolation.sql
-- Test: Aislamiento del rol customs_broker (AJ1).
-- Verifica que customs_broker solo ve embarques con customs_managed=true
-- y customs_user_id = auth.uid().
-- La RLS es la fuente de verdad (no es un filtro de UI).

BEGIN;
SET LOCAL session_replication_role = 'replica';

-- ── Fixtures ─────────────────────────────────────────────────────────────────

INSERT INTO public.tenants (id, name, slug, country, status)
VALUES ('cccc0001-0000-0000-0000-000000000001', 'Test CB', 'testcb', 'DO', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO public.accounts (id, tenant_id, name, kind)
VALUES ('cccc0001-0000-0000-0000-000000000002', 'cccc0001-0000-0000-0000-000000000001', 'Cliente CB', 'customer')
ON CONFLICT DO NOTHING;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('cbcb0001-0000-0000-0000-000000000001', 'broker1@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated'),
  ('cbcb0001-0000-0000-0000-000000000002', 'broker2@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated'),
  ('cbcb0001-0000-0000-0000-000000000003', 'operator_cb@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, full_name)
VALUES
  ('cbcb0001-0000-0000-0000-000000000001', 'Broker 1'),
  ('cbcb0001-0000-0000-0000-000000000002', 'Broker 2'),
  ('cbcb0001-0000-0000-0000-000000000003', 'Operador CB')
ON CONFLICT DO NOTHING;

-- Membresías: broker1 y broker2 son customs_broker; operator es operador
INSERT INTO public.memberships (id, tenant_id, user_id, role, is_active)
VALUES
  ('cbcb0002-0000-0000-0000-000000000001', 'cccc0001-0000-0000-0000-000000000001', 'cbcb0001-0000-0000-0000-000000000001', 'customs_broker', true),
  ('cbcb0002-0000-0000-0000-000000000002', 'cccc0001-0000-0000-0000-000000000001', 'cbcb0001-0000-0000-0000-000000000002', 'customs_broker', true),
  ('cbcb0002-0000-0000-0000-000000000003', 'cccc0001-0000-0000-0000-000000000001', 'cbcb0001-0000-0000-0000-000000000003', 'operator', true)
ON CONFLICT DO NOTHING;

-- Embarque 1: tiene gestión aduanal, asignado a broker1
INSERT INTO public.shipments (id, tenant_id, number, account_id, stage_key,
  customs_managed, customs_user_id, service_type)
VALUES ('cbcc0001-0000-0000-0000-000000000001',
  'cccc0001-0000-0000-0000-000000000001', 'EMB-CB-001',
  'cccc0001-0000-0000-0000-000000000002', 'booked',
  true, 'cbcb0001-0000-0000-0000-000000000001', 'mar_import')
ON CONFLICT DO NOTHING;

-- Embarque 2: tiene gestión aduanal, asignado a broker2 (no a broker1)
INSERT INTO public.shipments (id, tenant_id, number, account_id, stage_key,
  customs_managed, customs_user_id, service_type)
VALUES ('cbcc0001-0000-0000-0000-000000000002',
  'cccc0001-0000-0000-0000-000000000001', 'EMB-CB-002',
  'cccc0001-0000-0000-0000-000000000002', 'booked',
  true, 'cbcb0001-0000-0000-0000-000000000002', 'mar_import')
ON CONFLICT DO NOTHING;

-- Embarque 3: NO tiene gestión aduanal (customs_managed=false)
INSERT INTO public.shipments (id, tenant_id, number, account_id, stage_key,
  customs_managed, service_type)
VALUES ('cbcc0001-0000-0000-0000-000000000003',
  'cccc0001-0000-0000-0000-000000000001', 'EMB-CB-003',
  'cccc0001-0000-0000-0000-000000000002', 'booked',
  false, 'mar_export')
ON CONFLICT DO NOTHING;

-- ── Tests ─────────────────────────────────────────────────────────────────────

-- T1: broker1 SÍ ve el embarque que tiene asignado
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'cbcb0001-0000-0000-0000-000000000001', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE id = 'cbcc0001-0000-0000-0000-000000000001';
  ASSERT cnt = 1, 'T1 FAIL: broker1 no ve su embarque asignado, cnt=' || cnt;
  RAISE NOTICE 'T1 PASS: broker1 ve su embarque asignado';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T2: broker1 NO ve el embarque asignado a broker2
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'cbcb0001-0000-0000-0000-000000000001', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE id = 'cbcc0001-0000-0000-0000-000000000002';
  ASSERT cnt = 0, 'T2 FAIL: broker1 ve embarque asignado a broker2, cnt=' || cnt;
  RAISE NOTICE 'T2 PASS: broker1 no ve embarques de otros brokers';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T3: broker1 NO ve embarques sin gestión aduanal (customs_managed=false)
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'cbcb0001-0000-0000-0000-000000000001', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE id = 'cbcc0001-0000-0000-0000-000000000003';
  ASSERT cnt = 0, 'T3 FAIL: broker1 ve embarque sin gestión aduanal, cnt=' || cnt;
  RAISE NOTICE 'T3 PASS: broker1 no ve embarques sin customs_managed';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T4: broker1 ve EXACTAMENTE 1 embarque en todo el tenant
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'cbcb0001-0000-0000-0000-000000000001', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE tenant_id = 'cccc0001-0000-0000-0000-000000000001';
  ASSERT cnt = 1, 'T4 FAIL: broker1 ve ' || cnt || ' embarques (esperado 1)';
  RAISE NOTICE 'T4 PASS: broker1 ve exactamente 1 embarque en el tenant';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T5: operador (staff) ve los 3 embarques del tenant (regresión)
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'cbcb0001-0000-0000-0000-000000000003', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE tenant_id = 'cccc0001-0000-0000-0000-000000000001';
  ASSERT cnt = 3, 'T5 FAIL: operador no ve todos los embarques, cnt=' || cnt;
  RAISE NOTICE 'T5 PASS: operador ve los 3 embarques del tenant';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T6 (estructural): política shipments_sel restringe customs_broker a nivel DB
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'shipments'
      AND polname    = 'shipments_sel'
      AND qual::text ILIKE '%customs_broker%'
      AND qual::text ILIKE '%customs_managed%'
      AND qual::text ILIKE '%customs_user_id%'
  ) THEN
    RAISE EXCEPTION 'T6 FAIL: política shipments_sel no restringe customs_broker a nivel DB';
  END IF;
  RAISE NOTICE 'T6 PASS: shipments_sel tiene restricción customs_broker';
END $$;

ROLLBACK;
