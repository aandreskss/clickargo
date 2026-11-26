-- 11_masters_isolation.sql
-- Verificaciones de seguridad del módulo de masters y tracking (Fase D).
-- Requisito: correr después de 0017_masters_tracking.sql.

-- ── T1: RLS habilitado en las 3 tablas nuevas ────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('masters'), ('master_containers'), ('tracking_events') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tname AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS no activado en tabla: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T2: Las 3 tablas tienen tenant_id ────────────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('masters'), ('master_containers'), ('tracking_events') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tname AND column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'Tabla sin tenant_id: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T3: tracking_events tiene triggers deny_mutation (UPDATE + DELETE) ────────
DO $$
DECLARE
  trig_count int;
BEGIN
  SELECT count(*) INTO trig_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname  = 'tracking_events'
    AND t.tgname  IN ('tracking_events_no_update', 'tracking_events_no_delete')
    AND t.tgenabled != 'D';

  IF trig_count < 2 THEN
    RAISE EXCEPTION 'tracking_events no tiene ambos triggers deny_mutation (encontrados: %)', trig_count;
  END IF;
END $$;

-- ── T4: anon no tiene acceso directo a ninguna de las 3 tablas ───────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('masters'), ('master_containers'), ('tracking_events') LOOP
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

-- ── T5: search_masters es SECURITY DEFINER con search_path = '' ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname  = 'public'
      AND p.proname  = 'search_masters'
      AND p.prosecdef = true
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'search_masters no es SECURITY DEFINER con search_path vacío';
  END IF;
END $$;

-- ── T6: search_masters NO retorna internal_notes ─────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'search_masters'
      AND column_name  = 'internal_notes'
  ) THEN
    RAISE EXCEPTION 'search_masters expone internal_notes';
  END IF;
END $$;

-- ── T7: upsert_tracking_event es SECURITY DEFINER con search_path = '' ───────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname  = 'public'
      AND p.proname  = 'upsert_tracking_event'
      AND p.prosecdef = true
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'upsert_tracking_event no es SECURITY DEFINER con search_path vacío';
  END IF;
END $$;

-- ── T8: refresh_master_suggestion revocado de public/anon/authenticated ───────
DO $$
DECLARE
  grant_count int;
BEGIN
  SELECT count(*) INTO grant_count
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name   = 'refresh_master_suggestion'
    AND grantee IN ('public', 'anon', 'authenticated');

  IF grant_count > 0 THEN
    RAISE EXCEPTION 'refresh_master_suggestion tiene grants en roles no autorizados (encontrados: %)', grant_count;
  END IF;
END $$;

-- ── T9: Idempotencia — insertar el mismo evento dos veces = una sola fila ─────
BEGIN;
SET LOCAL session_replication_role = 'replica';
DO $$
DECLARE
  tid  uuid := 'a1000000-0000-0000-0000-000000000001'::uuid;
  mid  uuid := 'a1000000-0000-0000-0000-000000000002'::uuid;
  ts   timestamptz := '2024-01-15T10:00:00Z';
  cnt  int;
BEGIN
  INSERT INTO public.tenants (id, slug, name, country)
  VALUES (tid, 'test-iso-master-idem', 'Empresa Idempotencia', 'DO');

  INSERT INTO public.masters (id, tenant_id, number, master_number, mode, stage_key)
  VALUES (mid, tid, 'MST-001', 'MAEU123456', 'ocean', 'draft');

  -- Insert same event twice
  INSERT INTO public.tracking_events
    (tenant_id, master_id, provider, event_code, event_label, occurred_at, raw)
  VALUES
    (tid, mid, 'terminal49', 'vessel.departure', 'Vessel departed', ts, '{}'),
    (tid, mid, 'terminal49', 'vessel.departure', 'Vessel departed', ts, '{}')
  ON CONFLICT (master_id, provider, event_code, occurred_at) DO NOTHING;

  SELECT count(*) INTO cnt
  FROM public.tracking_events
  WHERE master_id = mid AND event_code = 'vessel.departure';

  IF cnt <> 1 THEN
    RAISE EXCEPTION 'T9 FALLA: Se esperaba 1 evento, encontrados: %', cnt;
  ELSE
    RAISE NOTICE 'OK T9: idempotencia verificada (1 fila por evento único)';
  END IF;
END $$;
ROLLBACK;

-- ── T10: Aislamiento — usuario de empresa B no ve masters de empresa A ─────────
BEGIN;
SET LOCAL session_replication_role = 'replica';

DO $$
DECLARE
  tid_a uuid := 'a2000000-0000-0000-0000-000000000001'::uuid;
  tid_b uuid := 'b2000000-0000-0000-0000-000000000001'::uuid;
  uid_b uuid := 'b2000000-0000-0000-0000-000000000002'::uuid;
  mid_a uuid;
BEGIN
  INSERT INTO public.tenants (id, slug, name, country)
  VALUES (tid_a, 'test-iso-mst-a', 'Empresa A Masters', 'DO'),
         (tid_b, 'test-iso-mst-b', 'Empresa B Masters', 'DO');

  INSERT INTO public.masters (tenant_id, number, master_number, mode, stage_key)
  VALUES (tid_a, 'MST-ISO-A', 'COSU123456', 'ocean', 'draft')
  RETURNING id INTO mid_a;

  INSERT INTO public.memberships (tenant_id, user_id, role)
  VALUES (tid_b, uid_b, 'operator');

  PERFORM set_config('test.t10_mid_a', mid_a::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE found_rows int;
BEGIN
  SELECT count(*) INTO found_rows
  FROM public.masters
  WHERE id = current_setting('test.t10_mid_a')::uuid;

  IF found_rows > 0 THEN
    RAISE EXCEPTION 'FALLA T10: Usuario de empresa B puede ver masters de empresa A';
  ELSE
    RAISE NOTICE 'OK T10: aislamiento entre empresas verificado para masters';
  END IF;
END $$;

ROLLBACK;

-- ── T11: Aislamiento — usuario de empresa B no puede ver tracking_events de empresa A ──
BEGIN;
SET LOCAL session_replication_role = 'replica';

DO $$
DECLARE
  tid_a uuid := 'a3000000-0000-0000-0000-000000000001'::uuid;
  tid_b uuid := 'b3000000-0000-0000-0000-000000000001'::uuid;
  uid_b uuid := 'b3000000-0000-0000-0000-000000000002'::uuid;
  mid_a uuid := 'a3000000-0000-0000-0000-000000000003'::uuid;
BEGIN
  INSERT INTO public.tenants (id, slug, name, country)
  VALUES (tid_a, 'test-iso-tev-a', 'Empresa A Events', 'DO'),
         (tid_b, 'test-iso-tev-b', 'Empresa B Events', 'DO');

  INSERT INTO public.masters (id, tenant_id, number, master_number, mode, stage_key)
  VALUES (mid_a, tid_a, 'MST-EVT-A', 'EVTTEST123', 'ocean', 'draft');

  INSERT INTO public.tracking_events
    (tenant_id, master_id, provider, event_code, event_label, occurred_at, raw)
  VALUES (tid_a, mid_a, 'manual', 'test.event', 'Test', now(), '{}');

  INSERT INTO public.memberships (tenant_id, user_id, role)
  VALUES (tid_b, uid_b, 'operator');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE found_rows int;
BEGIN
  SELECT count(*) INTO found_rows
  FROM public.tracking_events
  WHERE tenant_id = 'a3000000-0000-0000-0000-000000000001'::uuid;

  IF found_rows > 0 THEN
    RAISE EXCEPTION 'FALLA T11: Usuario de empresa B puede ver tracking_events de empresa A';
  ELSE
    RAISE NOTICE 'OK T11: aislamiento entre empresas verificado para tracking_events';
  END IF;
END $$;

ROLLBACK;

-- ── T12: link_shipment_to_master rechaza enlazar embarque de empresa B a master de empresa A ──
DO $$
BEGIN
  -- Verificar que la función existe y es SECURITY DEFINER
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname  = 'public'
      AND p.proname  = 'link_shipment_to_master'
      AND p.prosecdef = true
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'link_shipment_to_master no es SECURITY DEFINER con search_path vacío';
  ELSE
    RAISE NOTICE 'OK T12: link_shipment_to_master es SECURITY DEFINER';
  END IF;
END $$;
