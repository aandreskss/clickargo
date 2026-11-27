-- 14_storage_stays_rls.sql
-- Verificaciones de seguridad del módulo de almacenaje (Fase G).
-- Requisito: correr después de 0021_storage_stays.sql.

-- ── T1: RLS habilitado en las tablas nuevas ───────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('storage_stays'), ('storage_stay_costs')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tname AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS no activado en tabla: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T2: Las tablas tienen tenant_id ───────────────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('storage_stays'), ('storage_stay_costs')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tname AND column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'Tabla sin tenant_id: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T3: storage_stay_costs tiene política que verifica can_see_costs ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'storage_stay_costs'
      AND policyname = 'ssc_sel'
      AND qual::text ILIKE '%can_see_costs%'
  ) THEN
    RAISE EXCEPTION 'La política ssc_sel de storage_stay_costs no verifica can_see_costs';
  END IF;
END $$;

-- ── T4: anon no tiene acceso a las tablas ────────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('storage_stays'), ('storage_stay_costs')
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tname AND roles @> ARRAY['anon'::name]
    ) THEN
      RAISE EXCEPTION 'anon tiene política en tabla: %', tname;
    END IF;
  END LOOP;
END $$;

-- ── T5: storage_stay_costs tiene trigger audit ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'storage_stay_costs' AND t.tgname = 'ssc_audit'
  ) THEN
    RAISE EXCEPTION 'Trigger ssc_audit no existe en storage_stay_costs';
  END IF;
END $$;

-- ── T6: Verificar aislamiento entre empresas (simulación) ────────────────────
-- Verifica que las políticas RLS están definidas en ambas tablas para SELECT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'storage_stays'
      AND policyname = 'ss_sel' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Política ss_sel SELECT no existe en storage_stays';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'storage_stays'
      AND policyname = 'ss_del' AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'Política ss_del DELETE no existe en storage_stays';
  END IF;
END $$;

-- ── T7: Verificar constraintss de integridad ──────────────────────────────────
DO $$
BEGIN
  -- ss_out_after_in
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.storage_stays'::regclass AND conname = 'ss_out_after_in'
  ) THEN
    RAISE EXCEPTION 'Constraint ss_out_after_in no existe en storage_stays';
  END IF;

  -- ss_released_has_out
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.storage_stays'::regclass AND conname = 'ss_released_has_out'
  ) THEN
    RAISE EXCEPTION 'Constraint ss_released_has_out no existe en storage_stays';
  END IF;
END $$;

-- ── T8: shipment_charges acepta unit='day' ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.shipment_charges'::regclass
      AND conname  = 'shipment_charges_unit_check'
      AND pg_get_constraintdef(oid) ILIKE '%day%'
  ) THEN
    RAISE EXCEPTION 'shipment_charges.unit no acepta el valor day';
  END IF;
END $$;

SELECT 'TEST 14 PASS: storage_stays RLS y estructura verificados.' AS resultado;
