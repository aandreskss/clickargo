-- 04_tenant_isolation.sql
-- Verifica que un usuario de empresa A no puede leer ni modificar datos de empresa B.
-- Requiere dos usuarios y dos tenants de prueba ficticios.
-- Ejecutar con: psql -v ON_ERROR_STOP=1 -f 04_tenant_isolation.sql

BEGIN;

-- Crear usuarios y empresas de prueba ficticios.
DO $$
DECLARE
  tid_a uuid := gen_random_uuid();
  tid_b uuid := gen_random_uuid();
  uid_a uuid := gen_random_uuid();
  uid_b uuid := gen_random_uuid();
  aid   uuid;
  count_rows int;
BEGIN
  -- Crear tenants de prueba.
  INSERT INTO public.tenants (id, slug, name, country)
  VALUES (tid_a, 'test-aislamiento-a', 'Empresa A (test)', 'DO'),
         (tid_b, 'test-aislamiento-b', 'Empresa B (test)', 'DO');

  -- Crear perfiles de usuarios de prueba.
  INSERT INTO public.profiles (id, full_name) VALUES (uid_a, 'Usuario A test'), (uid_b, 'Usuario B test');

  -- Crear membresías.
  INSERT INTO public.memberships (tenant_id, user_id, role)
  VALUES (tid_a, uid_a, 'operator'), (tid_b, uid_b, 'operator');

  -- Crear cuenta en empresa A.
  INSERT INTO public.accounts (tenant_id, name, kind)
  VALUES (tid_a, 'Cliente secreto de A', 'customer')
  RETURNING id INTO aid;

  -- Simular que uid_b (empresa B) intenta leer la cuenta de empresa A.
  -- Fijamos el contexto de auth.uid() al usuario B.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_b::text)::text, true);

  -- Esta cuenta NO debería ser visible para uid_b (RLS solo muestra las del tenant propio).
  SELECT count(*) INTO count_rows FROM public.accounts WHERE id = aid;

  IF count_rows > 0 THEN
    RAISE EXCEPTION 'FALLA: Usuario de empresa B puede ver datos de empresa A.';
  ELSE
    RAISE NOTICE 'OK: aislamiento entre empresas verificado.';
  END IF;
END;
$$;

ROLLBACK; -- Deshacer todo: los datos de prueba no deben persistir.
