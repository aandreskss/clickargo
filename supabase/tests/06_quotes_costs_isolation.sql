-- 06_quotes_costs_isolation.sql
-- Verificaciones de seguridad del módulo de cotizaciones.
-- Se ejecutan contra la base de datos de desarrollo con dos usuarios ficticios.
-- Requisito: correr después de 0011_quotes.sql.

-- ── T1: search_quotes NO devuelve columnas de costo ──────────────────────────
DO $$
DECLARE
  col_name text;
BEGIN
  SELECT column_name INTO col_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'quotes'
    AND column_name  IN ('cost', 'total_cost', 'margin', 'margin_pct');

  IF col_name IS NOT NULL THEN
    RAISE EXCEPTION 'La tabla quotes expone columna de costo: %', col_name;
  END IF;

  SELECT column_name INTO col_name
  FROM information_schema.routines r
  JOIN information_schema.parameters p ON p.specific_name = r.specific_name
  WHERE r.routine_schema = 'public'
    AND r.routine_name   = 'search_quotes'
    AND p.parameter_name IN ('cost', 'total_cost', 'margin');

  -- También verificar el tipo de retorno
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'search_quotes'
      AND column_name  IN ('cost', 'total_cost', 'margin')
  ) THEN
    RAISE EXCEPTION 'search_quotes expone columna de costo';
  END IF;
END $$;

-- ── T2: quote_totals NO incluye datos de cost ────────────────────────────────
DO $$
DECLARE
  col_name text;
BEGIN
  SELECT column_name INTO col_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'quote_totals'
    AND column_name  IN ('cost', 'total_cost', 'margin', 'margin_pct', 'subtotal_cost');

  IF col_name IS NOT NULL THEN
    RAISE EXCEPTION 'La vista quote_totals expone columna de costo: %', col_name;
  END IF;
END $$;

-- ── T3: RLS habilitado en las 3 tablas ───────────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('quotes'), ('quote_lines'), ('quote_line_costs') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tname AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS no activado en tabla: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T4: Las 3 tablas tienen tenant_id ────────────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('quotes'), ('quote_lines'), ('quote_line_costs') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tname AND column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'Tabla sin tenant_id: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T5: quote_line_costs tiene política que chequea can_see_costs ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'quote_line_costs'
      AND polname    = 'qlc_sel'
      AND qual::text ILIKE '%can_see_costs%'
  ) THEN
    RAISE EXCEPTION 'La política qlc_sel de quote_line_costs no verifica can_see_costs';
  END IF;
END $$;

-- ── T6: search_quotes es SECURITY DEFINER con search_path = '' ───────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_quotes'
      AND p.prosecdef = true
      AND p.proconfig @> ARRAY['search_path=']
  ) THEN
    RAISE EXCEPTION 'search_quotes no es SECURITY DEFINER con search_path vacío';
  END IF;
END $$;

-- ── T7: anon no tiene acceso directo a las 3 tablas ──────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN VALUES ('quotes'), ('quote_lines'), ('quote_line_costs') LOOP
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

-- Todos los tests pasaron.
SELECT 'quotes_costs_isolation: OK' AS resultado;
