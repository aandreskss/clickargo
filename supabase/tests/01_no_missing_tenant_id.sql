-- 01_no_missing_tenant_id.sql
-- Falla si existe alguna tabla de negocio sin columna tenant_id.
-- Excluye tablas de control (tenants, profiles, reserved_slugs) y sistema.

DO $$
DECLARE
  missing_tenant text[];
  excluded_tables text[] := ARRAY['tenants', 'profiles', 'reserved_slugs'];
BEGIN
  SELECT array_agg(tablename ORDER BY tablename)
  INTO missing_tenant
  FROM pg_tables pt
  WHERE pt.schemaname = 'public'
    AND NOT (pt.tablename = ANY(excluded_tables))
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = pt.tablename
        AND c.column_name = 'tenant_id'
    );

  IF missing_tenant IS NOT NULL THEN
    RAISE EXCEPTION 'Tablas sin tenant_id en esquema public: %', array_to_string(missing_tenant, ', ');
  END IF;

  RAISE NOTICE 'OK: todas las tablas de negocio tienen tenant_id.';
END;
$$;
