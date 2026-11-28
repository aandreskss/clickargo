-- 17_charge_itbis.sql
-- Test: Categorías de cargo confirmadas y columna itbis_aplica (AJ1).
-- Verifica esquema, datos y que el cálculo de ITBIS sigue siendo server-only.
-- Solo tests estructurales: no requiere sesión de usuario autenticado.

-- ── T1: columna itbis_aplica existe (renombrada de taxable_default) ───────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'charge_types'
      AND column_name  = 'itbis_aplica'
  ) THEN
    RAISE EXCEPTION 'T1 FAIL: charge_types no tiene columna itbis_aplica';
  END IF;
  RAISE NOTICE 'T1 PASS: columna itbis_aplica existe';
END $$;

-- ── T2: columna taxable_default ya NO existe (fue renombrada) ─────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'charge_types'
      AND column_name  = 'taxable_default'
  ) THEN
    RAISE EXCEPTION 'T2 FAIL: charge_types todavía tiene columna taxable_default';
  END IF;
  RAISE NOTICE 'T2 PASS: taxable_default correctamente eliminada';
END $$;

-- ── T3: 7 categorías con itbis_aplica=true (cargos locales RD) ───────────────
DO $$
DECLARE
  missing_code text;
BEGIN
  FOR missing_code IN
    SELECT v.code FROM
      (VALUES
        ('aduana'),
        ('verificacion'),
        ('contenedor_adicional'),
        ('cfs'),
        ('dthc_lcl'),
        ('fhc_lcl'),
        ('tasas_aeroportuarias')
      ) v(code)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.charge_types ct
      WHERE ct.code = v.code AND ct.itbis_aplica = true
    )
  LOOP
    RAISE EXCEPTION 'T3 FAIL: categoría "%" no tiene itbis_aplica=true', missing_code;
  END LOOP;
  RAISE NOTICE 'T3 PASS: las 7 categorías ITBIS tienen itbis_aplica=true';
END $$;

-- ── T4: 6 nuevas categorías insertadas por 0029 existen en el catálogo ────────
DO $$
DECLARE
  missing_code text;
BEGIN
  FOR missing_code IN
    SELECT v.code FROM
      (VALUES
        ('verificacion'),
        ('contenedor_adicional'),
        ('cfs'),
        ('dthc_lcl'),
        ('fhc_lcl'),
        ('tasas_aeroportuarias')
      ) v(code)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.charge_types WHERE code = v.code
    )
  LOOP
    RAISE EXCEPTION 'T4 FAIL: categoría "%" no existe en charge_types', missing_code;
  END LOOP;
  RAISE NOTICE 'T4 PASS: las 6 categorías nuevas están en el catálogo';
END $$;

-- ── T5: 'aduana' tiene el nombre correcto ('Gestión aduanal') ─────────────────
DO $$
DECLARE v_name text;
BEGIN
  SELECT name INTO v_name FROM public.charge_types WHERE code = 'aduana';
  IF v_name IS DISTINCT FROM 'Gestión aduanal' THEN
    RAISE EXCEPTION 'T5 FAIL: aduana tiene nombre "%" (esperado "Gestión aduanal")', v_name;
  END IF;
  RAISE NOTICE 'T5 PASS: aduana se llama "Gestión aduanal"';
END $$;

-- ── T6: charge_types es catálogo global (sin tenant_id) ──────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'charge_types'
      AND column_name  = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'T6 FAIL: charge_types tiene tenant_id (debe ser catálogo global)';
  END IF;
  RAISE NOTICE 'T6 PASS: charge_types es catálogo global sin tenant_id';
END $$;

-- ── T7: anon NO puede escribir en charge_types ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema  = 'public'
      AND table_name    = 'charge_types'
      AND grantee       = 'anon'
      AND privilege_type IN ('INSERT','UPDATE','DELETE')
  ) THEN
    RAISE EXCEPTION 'T7 FAIL: anon tiene permisos de escritura en charge_types';
  END IF;
  RAISE NOTICE 'T7 PASS: anon no puede escribir en charge_types';
END $$;

-- ── T8: flete y otros cargos internacionales tienen itbis_aplica=false ─────────
DO $$
DECLARE
  wrong_code text;
BEGIN
  FOR wrong_code IN
    SELECT v.code FROM
      (VALUES ('flete'), ('thc_origen'), ('thc_destino'), ('bl_fee'), ('seguro'),
              ('isps'), ('demurrage'), ('detention'), ('almacenaje'))
      v(code)
    WHERE EXISTS (
      SELECT 1 FROM public.charge_types ct
      WHERE ct.code = v.code AND ct.itbis_aplica = true
    )
  LOOP
    RAISE EXCEPTION 'T8 FAIL: "%" tiene itbis_aplica=true pero no debería', wrong_code;
  END LOOP;
  RAISE NOTICE 'T8 PASS: cargos internacionales tienen itbis_aplica=false';
END $$;

SELECT '17_charge_itbis: OK' AS resultado;
