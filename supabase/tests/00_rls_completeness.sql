-- 00_rls_completeness.sql
-- Falla si existe alguna tabla en el esquema public sin RLS habilitado.

DO $$
DECLARE
  missing_rls text[];
BEGIN
  SELECT array_agg(tablename ORDER BY tablename)
  INTO missing_rls
  FROM pg_tables pt
  WHERE pt.schemaname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = pt.tablename
        AND c.relrowsecurity = true
    );

  IF missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Tablas sin RLS en esquema public: %', array_to_string(missing_rls, ', ');
  END IF;

  RAISE NOTICE 'OK: todas las tablas de public tienen RLS habilitado.';
END;
$$;
