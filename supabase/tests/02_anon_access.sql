-- 02_anon_access.sql
-- Verifica que el rol anon no tiene acceso SELECT a ninguna tabla del esquema public.
-- (El acceso a funciones se verifica por separado.)

DO $$
DECLARE
  r record;
  has_access bool;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  LOOP
    -- Verificar si anon tiene algún privilegio de SELECT en la tabla.
    SELECT bool_or(privilege_type = 'SELECT')
    INTO has_access
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = r.tablename
      AND grantee IN ('anon', 'PUBLIC');

    IF has_access THEN
      RAISE EXCEPTION 'El rol anon tiene acceso SELECT a la tabla public.%', r.tablename;
    END IF;
  END LOOP;

  RAISE NOTICE 'OK: el rol anon no tiene acceso SELECT directo a ninguna tabla.';
END;
$$;
