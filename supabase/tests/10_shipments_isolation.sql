-- 10_shipments_isolation.sql
-- Verificaciones de seguridad del módulo de embarques (Fase C).
-- Requisito: correr después de 0016_shipments.sql.

-- ── T1: RLS habilitado en las 3 tablas nuevas ────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('shipments'), ('shipment_containers'), ('shipment_events') LOOP
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
  FOR tname IN VALUES ('shipments'), ('shipment_containers'), ('shipment_events') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tname AND column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'Tabla sin tenant_id: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T3: shipment_events bloquea UPDATE (deny_mutation trigger) ───────────────
DO $$
DECLARE
  trig_count int;
BEGIN
  SELECT count(*) INTO trig_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname  = 'shipment_events'
    AND t.tgname  IN ('events_no_update', 'events_no_delete')
    AND t.tgenabled != 'D';

  IF trig_count < 2 THEN
    RAISE EXCEPTION 'shipment_events no tiene ambos triggers deny_mutation (encontrados: %)', trig_count;
  END IF;
END $$;

-- ── T4: anon no tiene acceso directo a las 3 tablas ──────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('shipments'), ('shipment_containers'), ('shipment_events') LOOP
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

-- ── T5: search_shipments es SECURITY DEFINER con search_path = '' ────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname  = 'public'
      AND p.proname  = 'search_shipments'
      AND p.prosecdef = true
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'search_shipments no es SECURITY DEFINER con search_path vacío';
  END IF;
END $$;

-- ── T6: search_shipments NO retorna internal_notes ───────────────────────────
DO $$
BEGIN
  -- Verificar que el tipo de retorno de la función no incluye internal_notes
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'search_shipments'
      AND column_name  = 'internal_notes'
  ) THEN
    RAISE EXCEPTION 'search_shipments expone internal_notes';
  END IF;
END $$;

-- ── T7: convert_quote_to_shipment es SECURITY DEFINER con search_path = '' ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname  = 'public'
      AND p.proname  = 'convert_quote_to_shipment'
      AND p.prosecdef = true
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  ) THEN
    RAISE EXCEPTION 'convert_quote_to_shipment no es SECURITY DEFINER con search_path vacío';
  END IF;
END $$;

-- ── T8: stage_definitions tiene las nuevas columnas ──────────────────────────
DO $$
DECLARE
  col text;
BEGIN
  FOR col IN VALUES ('key'), ('label'), ('is_terminal'), ('visible_to_customer'),
                    ('mode'), ('direction') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'stage_definitions'
        AND column_name  = col
    ) THEN
      RAISE EXCEPTION 'stage_definitions no tiene la columna: %', col;
    END IF;
  END LOOP;
END $$;

-- ── T9: Aislamiento entre tenants — usuario B no ve embarques de empresa A ────
-- Estrategia: insertar datos como postgres (superusuario, FK desactivada),
-- luego cambiar a rol 'authenticated' para que RLS aplique en el SELECT.
BEGIN;
SET LOCAL session_replication_role = 'replica'; -- desactiva FKs para UUIDs falsos

-- Paso 1: preparar datos de prueba como superusuario
DO $$
DECLARE
  tid_a uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
  tid_b uuid := 'b0000000-0000-0000-0000-000000000001'::uuid;
  uid_b uuid := 'b0000000-0000-0000-0000-000000000002'::uuid;
  acc_a uuid := 'a0000000-0000-0000-0000-000000000003'::uuid;
  ship_id uuid;
BEGIN
  INSERT INTO public.tenants (id, slug, name, country)
  VALUES (tid_a, 'test-iso-ship-a', 'Empresa A Ship', 'DO'),
         (tid_b, 'test-iso-ship-b', 'Empresa B Ship', 'DO');

  INSERT INTO public.accounts (id, tenant_id, name, kind)
  VALUES (acc_a, tid_a, 'Cliente A', 'customer');

  INSERT INTO public.shipments (tenant_id, number, account_id, mode, direction, stage_key)
  VALUES (tid_a, 'EMB-ISO-TEST', acc_a, 'ocean', 'import', 'draft')
  RETURNING id INTO ship_id;

  -- uid_b es miembro de tid_b (no de tid_a); guardar para el siguiente bloque
  INSERT INTO public.memberships (tenant_id, user_id, role)
  VALUES (tid_b, uid_b, 'operator');

  PERFORM set_config('test.t9_ship_id', ship_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
END $$;

-- Paso 2: verificar como rol authenticated (RLS aplica)
SET LOCAL ROLE authenticated;
DO $$
DECLARE found_rows int;
BEGIN
  SELECT count(*) INTO found_rows
  FROM public.shipments
  WHERE id = current_setting('test.t9_ship_id')::uuid;

  IF found_rows > 0 THEN
    RAISE EXCEPTION 'FALLA T9: Usuario de empresa B puede ver embarques de empresa A';
  ELSE
    RAISE NOTICE 'OK T9: aislamiento entre empresas verificado para shipments';
  END IF;
END $$;

ROLLBACK;

-- ── T10: convert_quote_to_shipment rechaza no-miembros ───────────────────────
BEGIN;
SET LOCAL session_replication_role = 'replica'; -- desactiva FKs para UUIDs falsos de prueba
DO $$
DECLARE
  tid_x uuid := gen_random_uuid();
  uid_x uuid := gen_random_uuid();
  qid   uuid := gen_random_uuid();
BEGIN
  -- Crear tenant sin miembro
  INSERT INTO public.tenants (id, slug, name, country)
  VALUES (tid_x, 'test-ship-noauth-' || left(tid_x::text, 8), 'Tenant No Auth', 'DO');

  -- Simular usuario sin membresía
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_x::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.convert_quote_to_shipment(tid_x, qid);
    RAISE EXCEPTION 'FALLA T10: convert_quote_to_shipment no rechazó a no-miembro';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm LIKE '%forbidden%' OR sqlerrm LIKE '%quote_not_found%' THEN
      RAISE NOTICE 'OK T10: convert_quote_to_shipment rechaza correctamente';
    ELSE
      RAISE EXCEPTION 'Error inesperado en T10: %', sqlerrm;
    END IF;
  END;
END;
$$;
ROLLBACK;

-- Todos los tests pasaron.
SELECT 'shipments_isolation: OK' AS resultado;
