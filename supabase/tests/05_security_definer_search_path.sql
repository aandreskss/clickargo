-- 05_security_definer_search_path.sql
-- Falla si existe alguna función SECURITY DEFINER sin SET search_path = ''.
-- Previene ataques de inyección de esquema.

DO $$
DECLARE
  missing_sp text[];
BEGIN
  SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname, p.proname)
  INTO missing_sp
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef = true                                    -- SECURITY DEFINER
    AND n.nspname IN ('public', 'private')                    -- solo nuestros esquemas
    AND NOT (
      -- Tiene set search_path = '' en su configuración.
      EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
    );

  IF missing_sp IS NOT NULL THEN
    RAISE EXCEPTION 'Funciones SECURITY DEFINER sin SET search_path: %',
      array_to_string(missing_sp, ', ');
  END IF;

  RAISE NOTICE 'OK: todas las funciones SECURITY DEFINER tienen search_path configurado.';
END;
$$;
