-- 09_charge_types_isolation.sql
-- Verifica que los tipos de cargo están aislados entre empresas.

BEGIN;

DO $$
DECLARE
  tid_a uuid := gen_random_uuid();
  tid_b uuid := gen_random_uuid();
  uid_a uuid := gen_random_uuid();
  uid_b uuid := gen_random_uuid();
  cid_a uuid;
  count_rows int;
  insert_ok  boolean;
BEGIN
  INSERT INTO public.tenants (id, slug, name) VALUES
    (tid_a, 'test-charges-a', 'Charges Test A'),
    (tid_b, 'test-charges-b', 'Charges Test B');

  INSERT INTO public.profiles (id, full_name) VALUES
    (uid_a, 'Admin A test'),
    (uid_b, 'Operator B test');

  INSERT INTO public.memberships (tenant_id, user_id, role) VALUES
    (tid_a, uid_a, 'owner'),
    (tid_b, uid_b, 'operator');

  -- Admin A crea un tipo de cargo
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_a::text)::text, true);
  INSERT INTO public.charge_types (tenant_id, code, name)
  VALUES (tid_a, 'FLT-TST', 'Flete de prueba A')
  RETURNING id INTO cid_a;
  RAISE NOTICE 'OK: Admin A creó cargo %.', cid_a;

  -- TEST 1: Admin A ve SU cargo
  SELECT count(*) INTO count_rows FROM public.charge_types WHERE id = cid_a;
  IF count_rows = 0 THEN
    RAISE EXCEPTION 'FALLA: Admin A no puede ver su propio cargo.';
  END IF;
  RAISE NOTICE 'OK T1: Admin A ve su cargo.';

  -- TEST 2: Operador B NO ve el cargo de empresa A
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_b::text)::text, true);
  SELECT count(*) INTO count_rows FROM public.charge_types WHERE id = cid_a;
  IF count_rows > 0 THEN
    RAISE EXCEPTION 'FALLA: Operador B puede ver cargo de empresa A.';
  END IF;
  RAISE NOTICE 'OK T2: Operador B no ve cargo de empresa A.';

  -- TEST 3: Operador B NO puede insertar cargo en empresa A
  insert_ok := false;
  BEGIN
    INSERT INTO public.charge_types (tenant_id, code, name)
    VALUES (tid_a, 'FLT-INV', 'Flete ilegal de B en A');
    insert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    insert_ok := false;
  END;
  IF insert_ok THEN
    RAISE EXCEPTION 'FALLA CRÍTICA: Operador B pudo insertar en empresa A.';
  END IF;
  RAISE NOTICE 'OK T3: Operador B no puede insertar en empresa A.';

  -- TEST 4: Operador de empresa B (no owner/admin) no puede insertar ni en su empresa
  insert_ok := false;
  BEGIN
    INSERT INTO public.charge_types (tenant_id, code, name)
    VALUES (tid_b, 'FLT-INV2', 'Flete ilegal operador');
    insert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    insert_ok := false;
  END;
  IF insert_ok THEN
    RAISE EXCEPTION 'FALLA: Operador pudo insertar charge_types (requiere owner/admin).';
  END IF;
  RAISE NOTICE 'OK T4: Operador no puede crear charge_types (correcto: requiere owner/admin).';

END;
$$;

ROLLBACK;
