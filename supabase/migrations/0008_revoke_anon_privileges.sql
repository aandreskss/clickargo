-- 0008_revoke_anon_privileges.sql
-- Mínimo privilegio para el rol anon: revocar acceso a todas las tablas,
-- secuencias y funciones del esquema public, luego otorgar solo lo estrictamente necesario.

-- Revocar acceso a todas las tablas actuales.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES  IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS  IN SCHEMA public FROM anon;

-- Revocar el privilegio por defecto de EXECUTE que PostgreSQL otorga a PUBLIC.
-- Esto afecta a las funciones creadas a partir de aquí.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL     ON TABLES    FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL     ON FUNCTIONS FROM anon;

-- Restaurar solo lo que anon necesita.
-- tenant_by_slug: necesaria para resolver la empresa desde el subdominio (antes del login).
GRANT EXECUTE ON FUNCTION public.tenant_by_slug(text) TO anon;
