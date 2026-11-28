-- 0029_charge_categories_itbis.sql
-- AJ1: Categorías de cargo confirmadas por Box To Go.
-- Contenido:
--   1. RENAME taxable_default → itbis_aplica (nombre correcto según reglas de negocio)
--   2. Corregir nombre de la categoría 'aduana' → 'Gestión aduanal'
--   3. Insertar 6 categorías nuevas con itbis_aplica = true
--   4. Actualizar itbis_aplica en 'almacenaje' (pasa a false; almacenaje con terceros no lleva ITBIS)

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Renombrar columna
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.charge_types RENAME COLUMN taxable_default TO itbis_aplica;

COMMENT ON COLUMN public.charge_types.itbis_aplica IS
  'TRUE = aplica ITBIS 18% (cargos locales RD). Cálculo siempre en servidor.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Corregir nombre de categorías existentes
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE public.charge_types
SET name = 'Gestión aduanal'
WHERE code = 'aduana';

-- almacenaje con terceros no lleva ITBIS según reglas de negocio
UPDATE public.charge_types
SET itbis_aplica = false
WHERE code = 'almacenaje';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Insertar 6 categorías nuevas (confirmadas por Box To Go, todas con ITBIS)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.charge_types (code, name, default_unit, itbis_aplica) VALUES
  ('verificacion',         'Verificación',                     'flat',      true),
  ('contenedor_adicional', 'Contenedor adicional',             'container', true),
  ('cfs',                  'CFS (Container Freight Station)',  'flat',      true),
  ('dthc_lcl',             'DTHC LCL',                        'flat',      true),
  ('fhc_lcl',              'FHC LCL',                         'flat',      true),
  ('tasas_aeroportuarias', 'Tasas aeroportuarias',             'flat',      true)
ON CONFLICT (code) DO NOTHING;
