-- 15_portal_isolation.sql
-- Test: Portal del cliente (Fase H)
-- Verifica que los clientes del portal solo ven sus propios datos y que el staff
-- no pierde acceso. Patrón idéntico a tests 10–14.

BEGIN;
SET LOCAL session_replication_role = 'replica';

-- ── Fixtures ─────────────────────────────────────────────────────────────────

-- Empresa de prueba
INSERT INTO public.tenants (id, name, slug, country, status)
VALUES ('bbbbbbbb-bb00-0000-0000-000000000001', 'Test Portal', 'testportal', 'DO', 'active')
ON CONFLICT DO NOTHING;

-- Cuentas
INSERT INTO public.accounts (id, tenant_id, name, kind)
VALUES
  ('cccccccc-cc00-0000-0000-000000000001', 'bbbbbbbb-bb00-0000-0000-000000000001', 'Cuenta A', 'customer'),
  ('cccccccc-cc00-0000-0000-000000000002', 'bbbbbbbb-bb00-0000-0000-000000000001', 'Cuenta B', 'customer')
ON CONFLICT DO NOTHING;

-- Usuarios ficticios
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('aaaaaaaa-aa00-0000-0000-000000000011', 'customer_a@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated'),
  ('aaaaaaaa-aa00-0000-0000-000000000012', 'customer_b@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated'),
  ('aaaaaaaa-aa00-0000-0000-000000000013', 'operator_p@test.com', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, full_name)
VALUES
  ('aaaaaaaa-aa00-0000-0000-000000000011', 'Cliente A'),
  ('aaaaaaaa-aa00-0000-0000-000000000012', 'Cliente B'),
  ('aaaaaaaa-aa00-0000-0000-000000000013', 'Operador P')
ON CONFLICT DO NOTHING;

-- Membresías: customer A → Cuenta A; customer B → Cuenta B; operator
INSERT INTO public.memberships (id, tenant_id, user_id, role, account_id, is_active)
VALUES
  ('dddddddd-dd00-0000-0000-000000000001', 'bbbbbbbb-bb00-0000-0000-000000000001', 'aaaaaaaa-aa00-0000-0000-000000000011', 'customer', 'cccccccc-cc00-0000-0000-000000000001', true),
  ('dddddddd-dd00-0000-0000-000000000002', 'bbbbbbbb-bb00-0000-0000-000000000001', 'aaaaaaaa-aa00-0000-0000-000000000012', 'customer', 'cccccccc-cc00-0000-0000-000000000002', true),
  ('dddddddd-dd00-0000-0000-000000000003', 'bbbbbbbb-bb00-0000-0000-000000000001', 'aaaaaaaa-aa00-0000-0000-000000000013', 'operator', NULL, true)
ON CONFLICT DO NOTHING;

-- Stage definitions para el tenant (necesaria para policy stage_defs_customer_sel)
INSERT INTO public.stage_definitions (tenant_id, stage_key, label, sort_order)
VALUES ('bbbbbbbb-bb00-0000-0000-000000000001', 'draft', 'Borrador', 1)
ON CONFLICT DO NOTHING;

-- Embarque A (pertenece a Cuenta A)
INSERT INTO public.shipments (id, tenant_id, number, account_id, stage_key, mode)
VALUES ('eeeeeeee-ee00-0000-0000-000000000001', 'bbbbbbbb-bb00-0000-0000-000000000001', 'EMB-001', 'cccccccc-cc00-0000-0000-000000000001', 'booked', 'ocean_import')
ON CONFLICT DO NOTHING;

-- Embarque B (pertenece a Cuenta B)
INSERT INTO public.shipments (id, tenant_id, number, account_id, stage_key, mode)
VALUES ('eeeeeeee-ee00-0000-0000-000000000002', 'bbbbbbbb-bb00-0000-0000-000000000001', 'EMB-002', 'cccccccc-cc00-0000-0000-000000000002', 'booked', 'ocean_import')
ON CONFLICT DO NOTHING;

-- Evento visible e invisible del embarque A
INSERT INTO public.shipment_events (id, tenant_id, shipment_id, kind, occurred_at, visible_to_customer)
VALUES
  ('ffffffff-ff00-0000-0000-000000000001', 'bbbbbbbb-bb00-0000-0000-000000000001', 'eeeeeeee-ee00-0000-0000-000000000001', 'stage_changed', NOW(), true),
  ('ffffffff-ff00-0000-0000-000000000002', 'bbbbbbbb-bb00-0000-0000-000000000001', 'eeeeeeee-ee00-0000-0000-000000000001', 'note', NOW(), false)
ON CONFLICT DO NOTHING;

-- Tracking link para el embarque A
INSERT INTO public.tracking_links (id, tenant_id, shipment_id, token_hash)
VALUES ('11111111-1100-0000-0000-000000000001', 'bbbbbbbb-bb00-0000-0000-000000000001', 'eeeeeeee-ee00-0000-0000-000000000001', 'testhash_ok')
ON CONFLICT DO NOTHING;

-- Tracking link revocado
INSERT INTO public.tracking_links (id, tenant_id, shipment_id, token_hash, revoked_at)
VALUES ('11111111-1100-0000-0000-000000000002', 'bbbbbbbb-bb00-0000-0000-000000000001', 'eeeeeeee-ee00-0000-0000-000000000002', 'testhash_revoked', NOW())
ON CONFLICT DO NOTHING;

-- ── Tests ─────────────────────────────────────────────────────────────────────

-- T1: Cliente A NO ve embarques de cliente B (mismo tenant)
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aa00-0000-0000-000000000011', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE tenant_id = 'bbbbbbbb-bb00-0000-0000-000000000001'
    AND account_id = 'cccccccc-cc00-0000-0000-000000000002';
  ASSERT cnt = 0, 'T1 FAIL: cliente A ve embarques de cliente B, cnt=' || cnt;
  RAISE NOTICE 'T1 PASS: cliente A no ve embarques de cliente B';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T2: Cliente A SÍ ve su propio embarque
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aa00-0000-0000-000000000011', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE id = 'eeeeeeee-ee00-0000-0000-000000000001';
  ASSERT cnt = 1, 'T2 FAIL: cliente A no puede ver su propio embarque';
  RAISE NOTICE 'T2 PASS: cliente A ve su propio embarque';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T3: Customer NO puede ver quotes (tabla solo para staff)
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aa00-0000-0000-000000000011', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.quotes
  WHERE tenant_id = 'bbbbbbbb-bb00-0000-0000-000000000001';
  ASSERT cnt = 0, 'T3 FAIL: customer ve cotizaciones del tenant';
  RAISE NOTICE 'T3 PASS: customer no ve cotizaciones';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T4: Customer NO ve shipment_events con visible_to_customer=false
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aa00-0000-0000-000000000011', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipment_events
  WHERE id = 'ffffffff-ff00-0000-0000-000000000002'; -- visible_to_customer=false
  ASSERT cnt = 0, 'T4 FAIL: customer ve eventos con visible_to_customer=false';
  RAISE NOTICE 'T4 PASS: customer no ve eventos ocultos';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T5: Customer NO ve membresías de staff (solo la suya)
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aa00-0000-0000-000000000011', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.memberships
  WHERE user_id = 'aaaaaaaa-aa00-0000-0000-000000000013'; -- el operador
  ASSERT cnt = 0, 'T5 FAIL: customer ve membresía del staff';
  RAISE NOTICE 'T5 PASS: customer no ve membresías del staff';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T6: Customer ve solo su propia cuenta (no la de cliente B)
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aa00-0000-0000-000000000011', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.accounts
  WHERE id = 'cccccccc-cc00-0000-0000-000000000002'; -- cuenta B
  ASSERT cnt = 0, 'T6 FAIL: customer ve cuenta de otro cliente';
  RAISE NOTICE 'T6 PASS: customer no ve cuentas ajenas';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T7: Staff (operator) sigue viendo todos los embarques de su tenant (regresión)
DO $$
DECLARE cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aa00-0000-0000-000000000013', 'role', 'authenticated'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.shipments
  WHERE tenant_id = 'bbbbbbbb-bb00-0000-0000-000000000001';
  ASSERT cnt = 2, 'T7 FAIL: staff no ve todos los embarques, cnt=' || cnt;
  RAISE NOTICE 'T7 PASS: staff ve todos los embarques del tenant';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T8: get_tracking_shipment con hash válido retorna datos
DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL ROLE anon;
  SELECT COUNT(*) INTO cnt FROM public.get_tracking_shipment('testhash_ok');
  ASSERT cnt = 1, 'T8 FAIL: get_tracking_shipment no retorna datos para hash válido';
  RAISE NOTICE 'T8 PASS: get_tracking_shipment retorna datos para hash válido';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T9: get_tracking_shipment con hash incorrecto retorna NULL
DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL ROLE anon;
  SELECT COUNT(*) INTO cnt FROM public.get_tracking_shipment('hash_que_no_existe');
  ASSERT cnt = 0, 'T9 FAIL: get_tracking_shipment retorna datos para hash inválido';
  RAISE NOTICE 'T9 PASS: get_tracking_shipment retorna NULL para hash inválido';
END $$;

SET LOCAL session_replication_role = 'replica';

-- T10: get_tracking_shipment con hash revocado retorna NULL
DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL ROLE anon;
  SELECT COUNT(*) INTO cnt FROM public.get_tracking_shipment('testhash_revoked');
  ASSERT cnt = 0, 'T10 FAIL: get_tracking_shipment retorna datos para enlace revocado';
  RAISE NOTICE 'T10 PASS: get_tracking_shipment retorna NULL para enlace revocado';
END $$;

ROLLBACK;
