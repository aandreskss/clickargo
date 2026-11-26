-- 0013_global_catalogs.sql
-- Catálogos globales de solo lectura: puertos, incoterms, tipos de contenedor.
-- Sin tenant_id. Legibles por cualquier usuario autenticado.
-- INSERT/UPDATE/DELETE explícitamente revocados.

-- ── Puertos (UN/LOCODE) ──────────────────────────────────────────────────────
CREATE TABLE public.ports (
  code        text    PRIMARY KEY,              -- UN/LOCODE, ej: DOPCM
  name        text    NOT NULL,
  country_code char(2) NOT NULL,
  type        text    NOT NULL CHECK (type IN ('sea','air','both')),
  is_featured boolean NOT NULL DEFAULT false    -- aparece primero en PortSelect
);

-- ── Incoterms 2020 ───────────────────────────────────────────────────────────
CREATE TABLE public.incoterms (
  code        text PRIMARY KEY,                 -- EXW, FOB, etc.
  name        text NOT NULL,
  description text
);

-- ── Tipos de contenedor ──────────────────────────────────────────────────────
CREATE TABLE public.container_types (
  code text    PRIMARY KEY,                     -- 20GP, 40HC, etc.
  name text    NOT NULL,
  teu  numeric(4,1) NOT NULL
);

-- ── RLS: solo SELECT para autenticados, nada para anon ───────────────────────
ALTER TABLE public.ports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoterms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.container_types  ENABLE ROW LEVEL SECURITY;

CREATE POLICY ports_select           ON public.ports           FOR SELECT TO authenticated USING (true);
CREATE POLICY incoterms_select       ON public.incoterms       FOR SELECT TO authenticated USING (true);
CREATE POLICY container_types_select ON public.container_types FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE/DELETE explícitamente denegados (ninguna política los permite).
-- Recordatorio: RLS activado + sin política = denegado por defecto.

REVOKE INSERT, UPDATE, DELETE ON public.ports           FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.incoterms       FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.container_types FROM authenticated, anon;

-- ── Seed: Puertos ────────────────────────────────────────────────────────────
INSERT INTO public.ports (code, name, country_code, type, is_featured) VALUES
  -- República Dominicana
  ('DOPCM', 'Caucedo (Multimodal)',           'DO', 'sea',  true),
  ('DOHAI', 'Haina',                          'DO', 'sea',  true),
  ('DOSDQ', 'Santo Domingo – Las Américas',   'DO', 'air',  true),
  ('DOPOP', 'Puerto Plata – Luperón',         'DO', 'air',  false),
  -- Estados Unidos
  ('USMIA', 'Miami',                          'US', 'both', true),
  ('USFLL', 'Fort Lauderdale / Port Everglades','US','sea', true),
  ('USHOU', 'Houston',                        'US', 'sea',  true),
  ('USNYC', 'Nueva York',                     'US', 'sea',  true),
  ('USJFK', 'Nueva York – JFK',               'US', 'air',  false),
  ('USSAV', 'Savannah',                       'US', 'sea',  false),
  ('USORF', 'Norfolk',                        'US', 'sea',  false),
  -- China
  ('CNSHA', 'Shanghái',                       'CN', 'sea',  true),
  ('CNNGB', 'Ningbo',                         'CN', 'sea',  true),
  ('CNTAO', 'Qingdao',                        'CN', 'sea',  true),
  ('CNYTN', 'Yantian (Shenzhen)',              'CN', 'sea',  true),
  ('CNNAO', 'Nansha (Guangzhou)',              'CN', 'sea',  false),
  ('CNPVG', 'Shanghái – Pudong',              'CN', 'air',  false),
  -- Panamá
  ('PACOL', 'Colón (Manzanillo / Colon 2000)','PA', 'sea',  true),
  ('PAPTY', 'Ciudad de Panamá – Tocumen',     'PA', 'air',  false),
  -- Europa
  ('NLRTM', 'Rotterdam',                      'NL', 'sea',  false),
  ('BEANR', 'Amberes',                        'BE', 'sea',  false),
  ('DEHAM', 'Hamburgo',                       'DE', 'sea',  false),
  ('ESBCN', 'Barcelona',                      'ES', 'sea',  false),
  ('ESVLC', 'Valencia',                       'ES', 'sea',  false),
  ('ESMAD', 'Madrid – Barajas',               'ES', 'air',  false),
  ('ITGOA', 'Génova',                         'IT', 'sea',  false),
  -- América Latina
  ('BRSSZ', 'Santos (Brasil)',                'BR', 'sea',  false),
  ('COBUN', 'Buenaventura (Colombia)',         'CO', 'sea',  false),
  ('MXLZC', 'Lázaro Cárdenas (México)',       'MX', 'sea',  false),
  -- Turquía / Asia
  ('TRIST', 'Estambul',                       'TR', 'both', false),
  ('KRPUS', 'Busan (Corea del Sur)',           'KR', 'sea',  false)
ON CONFLICT (code) DO NOTHING;

-- ── Seed: Incoterms 2020 ─────────────────────────────────────────────────────
INSERT INTO public.incoterms (code, name, description) VALUES
  ('EXW', 'Ex Works',                            'El vendedor pone la mercancía a disposición en su local.'),
  ('FCA', 'Free Carrier',                        'El vendedor entrega al transportista designado por el comprador.'),
  ('CPT', 'Carriage Paid To',                    'El vendedor contrata el flete hasta el destino pactado.'),
  ('CIP', 'Carriage and Insurance Paid To',      'Como CPT, el vendedor también contrata el seguro.'),
  ('DAP', 'Delivered at Place',                  'El vendedor entrega en el lugar pactado en destino, sin desaduanar.'),
  ('DPU', 'Delivered at Place Unloaded',         'Como DAP, pero descargado. Solo incoterm que exige descarga al vendedor.'),
  ('DDP', 'Delivered Duty Paid',                 'El vendedor asume todos los costos hasta el destino, incluidos aranceles.'),
  ('FAS', 'Free Alongside Ship',                 'El vendedor entrega junto al barco en el puerto de origen.'),
  ('FOB', 'Free on Board',                       'El vendedor entrega a bordo del barco en el puerto de origen.'),
  ('CFR', 'Cost and Freight',                    'El vendedor paga flete hasta puerto de destino; el riesgo pasa con FOB.'),
  ('CIF', 'Cost, Insurance and Freight',         'Como CFR, el vendedor también contrata el seguro mínimo.')
ON CONFLICT (code) DO NOTHING;

-- ── Seed: Tipos de contenedor ────────────────────────────────────────────────
INSERT INTO public.container_types (code, name, teu) VALUES
  ('20GP', 'Seco 20 pies (20GP)',           1.0),
  ('40GP', 'Seco 40 pies (40GP)',           2.0),
  ('40HC', 'High Cube 40 pies (40HC)',      2.0),
  ('20RF', 'Refrigerado 20 pies (20RF)',    1.0),
  ('40RF', 'Refrigerado 40 pies (40RF)',    2.0),
  ('45HC', 'High Cube 45 pies (45HC)',      2.5),
  ('LCL',  'Carga consolidada (LCL)',       0.0)
ON CONFLICT (code) DO NOTHING;
