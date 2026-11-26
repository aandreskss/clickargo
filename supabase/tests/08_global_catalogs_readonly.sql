-- 08_global_catalogs_readonly.sql
-- Verifica que los catálogos globales son legibles por usuarios autenticados
-- pero no escribibles por nadie (ni anon ni authenticated).

BEGIN;

DO $$
DECLARE
  uid_a uuid := gen_random_uuid();
  tid_a uuid := gen_random_uuid();
  port_count  int;
  inco_count  int;
  cont_count  int;
  insert_ok   boolean;
BEGIN
  -- Setup mínimo
  INSERT INTO public.tenants  (id, slug, name) VALUES (tid_a, 'test-catalogs', 'Catalog Test');
  INSERT INTO public.profiles (id, full_name)  VALUES (uid_a, 'Usuario catalogo');
  INSERT INTO public.memberships (tenant_id, user_id, role) VALUES (tid_a, uid_a, 'operator');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_a::text)::text, true);

  -- TEST 1: Usuario autenticado puede leer puertos
  SELECT count(*) INTO port_count FROM public.ports;
  IF port_count = 0 THEN
    RAISE EXCEPTION 'FALLA: No se pudo leer la tabla ports (o está vacía tras el seed).';
  END IF;
  RAISE NOTICE 'OK T1: ports legible (% filas).', port_count;

  -- TEST 2: Usuario autenticado puede leer incoterms
  SELECT count(*) INTO inco_count FROM public.incoterms;
  IF inco_count = 0 THEN
    RAISE EXCEPTION 'FALLA: No se pudo leer la tabla incoterms (o está vacía).';
  END IF;
  RAISE NOTICE 'OK T2: incoterms legible (% filas).', inco_count;

  -- TEST 3: Usuario autenticado puede leer container_types
  SELECT count(*) INTO cont_count FROM public.container_types;
  IF cont_count = 0 THEN
    RAISE EXCEPTION 'FALLA: No se pudo leer la tabla container_types (o está vacía).';
  END IF;
  RAISE NOTICE 'OK T3: container_types legible (% filas).', cont_count;

  -- TEST 4: INSERT en ports falla para usuario autenticado
  insert_ok := false;
  BEGIN
    INSERT INTO public.ports (code, name, country_code, type)
    VALUES ('ZZTST', 'Puerto de prueba ilegal', 'ZZ', 'sea');
    insert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    insert_ok := false;
  END;
  IF insert_ok THEN
    RAISE EXCEPTION 'FALLA CRÍTICA: Usuario autenticado pudo insertar en la tabla ports.';
  END IF;
  RAISE NOTICE 'OK T4: INSERT en ports denegado para autenticado.';

  -- TEST 5: INSERT en incoterms falla para usuario autenticado
  insert_ok := false;
  BEGIN
    INSERT INTO public.incoterms (code, name) VALUES ('ZZZ', 'Incoterm ilegal');
    insert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    insert_ok := false;
  END;
  IF insert_ok THEN
    RAISE EXCEPTION 'FALLA CRÍTICA: Usuario autenticado pudo insertar en la tabla incoterms.';
  END IF;
  RAISE NOTICE 'OK T5: INSERT en incoterms denegado para autenticado.';

  -- TEST 6: Anon NO puede leer puertos (RLS solo para authenticated)
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}'::text, true);
  SELECT count(*) INTO port_count FROM public.ports;
  IF port_count > 0 THEN
    RAISE EXCEPTION 'FALLA: Anon puede leer la tabla ports.';
  END IF;
  RAISE NOTICE 'OK T6: ports no legible para anon.';

END;
$$;

ROLLBACK;
