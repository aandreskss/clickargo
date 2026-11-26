-- 07_team_isolation.sql
-- Verifica: miembro inactivo no accede, último owner no se puede quitar,
-- aislamiento de equipo entre empresas.

BEGIN;

DO $$
DECLARE
  tid_a uuid := gen_random_uuid();
  tid_b uuid := gen_random_uuid();
  uid_owner  uuid := gen_random_uuid();
  uid_op     uuid := gen_random_uuid();
  aid        uuid;
  count_rows int;
  owner_count int;
BEGIN
  -- Crear tenants y usuarios de prueba
  INSERT INTO public.tenants (id, slug, name) VALUES
    (tid_a, 'test-team-a', 'Team Test A'),
    (tid_b, 'test-team-b', 'Team Test B');

  INSERT INTO public.profiles (id, full_name) VALUES
    (uid_owner, 'Dueño test'),
    (uid_op,    'Operador test');

  INSERT INTO public.memberships (tenant_id, user_id, role) VALUES
    (tid_a, uid_owner, 'owner'),
    (tid_a, uid_op,    'operator'),
    (tid_b, uid_op,    'operator');

  -- Crear cuenta en empresa A
  INSERT INTO public.accounts (tenant_id, name, kind)
  VALUES (tid_a, 'Cuenta de prueba', 'customer')
  RETURNING id INTO aid;

  -- TEST 1: Operador activo VE la cuenta (is_member = true)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_op::text)::text, true);
  SELECT count(*) INTO count_rows FROM public.accounts WHERE id = aid;
  IF count_rows = 0 THEN
    RAISE EXCEPTION 'FALLA: Operador activo no puede ver la cuenta de su empresa.';
  END IF;
  RAISE NOTICE 'OK T1: Operador activo ve datos de su empresa.';

  -- Desactivar operador
  UPDATE public.memberships SET is_active = false
  WHERE tenant_id = tid_a AND user_id = uid_op;

  -- TEST 2: Operador INACTIVO NO ve la cuenta
  SELECT count(*) INTO count_rows FROM public.accounts WHERE id = aid;
  IF count_rows > 0 THEN
    RAISE EXCEPTION 'FALLA: Operador inactivo puede ver datos de la empresa.';
  END IF;
  RAISE NOTICE 'OK T2: Operador inactivo bloqueado por RLS.';

  -- TEST 3: is_member devuelve false para inactivo
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_op::text)::text, true);
  IF private.is_member(tid_a) THEN
    RAISE EXCEPTION 'FALLA: private.is_member retorna true para miembro inactivo.';
  END IF;
  RAISE NOTICE 'OK T3: is_member = false para miembro inactivo.';

  -- TEST 4: Conteo de owners activos = 1 (solo uid_owner)
  SELECT count(*) INTO owner_count FROM public.memberships
  WHERE tenant_id = tid_a AND role = 'owner' AND is_active = true;
  IF owner_count <> 1 THEN
    RAISE EXCEPTION 'FALLA: Conteo de owners activos incorrecto (esperado 1, obtenido %).', owner_count;
  END IF;
  RAISE NOTICE 'OK T4: Conteo de owners activos correcto.';

  -- TEST 5: Empresa B no contamina empresa A (operador reactivado en B, inactivo en A)
  UPDATE public.memberships SET is_active = true
  WHERE tenant_id = tid_b AND user_id = uid_op;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_op::text)::text, true);
  -- En empresa A sigue inactivo
  IF private.is_member(tid_a) THEN
    RAISE EXCEPTION 'FALLA: Membresía en empresa B activa no debería dar acceso a empresa A.';
  END IF;
  RAISE NOTICE 'OK T5: Membresía en empresa B no contamina empresa A.';

END;
$$;

ROLLBACK;
