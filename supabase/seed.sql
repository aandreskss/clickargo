-- supabase/seed.sql
-- Datos de demostración para Fase I (Reportes). Empresa ficticia: Demo Cargo SRL.
-- Idempotente: ON CONFLICT DO NOTHING en todos los inserts.
-- UUIDs en rango dddd... para identificación clara como datos demo.
-- NO contiene datos reales de Box To Go.

DO $$
DECLARE
  -- IDs de tenant y usuarios
  v_tenant   uuid := 'dddd0001-0000-0000-0000-000000000001';
  v_owner    uuid := 'dddd0002-0000-0000-0000-000000000001';
  v_operator uuid := 'dddd0002-0000-0000-0000-000000000002';

  -- Carriers (5 navieras ficticias)
  v_car UUID[] := ARRAY[
    'dddd0003-0000-0000-0000-000000000001'::uuid,
    'dddd0003-0000-0000-0000-000000000002'::uuid,
    'dddd0003-0000-0000-0000-000000000003'::uuid,
    'dddd0003-0000-0000-0000-000000000004'::uuid,
    'dddd0003-0000-0000-0000-000000000005'::uuid
  ];

  -- Customers (8 clientes ficticios)
  v_cust UUID[] := ARRAY[
    'dddd0004-0000-0000-0000-000000000001'::uuid,
    'dddd0004-0000-0000-0000-000000000002'::uuid,
    'dddd0004-0000-0000-0000-000000000003'::uuid,
    'dddd0004-0000-0000-0000-000000000004'::uuid,
    'dddd0004-0000-0000-0000-000000000005'::uuid,
    'dddd0004-0000-0000-0000-000000000006'::uuid,
    'dddd0004-0000-0000-0000-000000000007'::uuid,
    'dddd0004-0000-0000-0000-000000000008'::uuid
  ];

  -- Variables de iteración
  v_month     int;
  v_i         int;
  v_n         int;
  v_ship_id   uuid;
  v_charge1   uuid;
  v_charge2   uuid;
  v_charge3   uuid;
  v_stype     text;
  v_mode      text;
  v_direction text;
  v_stage     text;
  v_eta       date;
  v_ata       date;
  v_created   timestamptz;
  v_carrier   uuid;
  v_customer  uuid;
  v_qstatus   text;
  v_vuntil    date;
  v_service_arr text[] := ARRAY['mar_import','mar_export','aire_import','aire_export','aduana','transporte'];
  v_port_orig text[] := ARRAY['USMIA','USFLL','USNYC','USMIA','USMIA','USMIA'];
  v_port_dest text[] := ARRAY['DOPCM','DOHAI','DOPCM','DOPCM','DOSDQ','DOPCM'];
BEGIN

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 1. Tenant
  -- ══════════════════════════════════════════════════════════════════════════════
  INSERT INTO public.tenants (id, name, slug, country, status)
  VALUES (v_tenant, 'Demo Cargo SRL', 'demo', 'DO', 'active')
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 2. Usuarios auth (seed directo en auth.users)
  -- ══════════════════════════════════════════════════════════════════════════════
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  ) VALUES
    (v_owner,    'owner@demo.test',    'x', NOW(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_operator, 'operator@demo.test', 'x', NOW(), '{}', '{}', 'authenticated', 'authenticated')
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 3. Perfiles
  -- ══════════════════════════════════════════════════════════════════════════════
  INSERT INTO public.profiles (id, full_name)
  VALUES
    (v_owner,    'Ana García'),
    (v_operator, 'Carlos Medina')
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 4. Membresías
  -- ══════════════════════════════════════════════════════════════════════════════
  INSERT INTO public.memberships (id, tenant_id, user_id, role, is_active, can_see_costs)
  VALUES
    ('dddd0007-0000-0000-0000-000000000001', v_tenant, v_owner,    'owner',    true, true),
    ('dddd0007-0000-0000-0000-000000000002', v_tenant, v_operator, 'operator', true, false)
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 5. Carriers (navieras ficticias, kind='carrier')
  -- ══════════════════════════════════════════════════════════════════════════════
  INSERT INTO public.accounts (id, tenant_id, kind, name, created_by)
  VALUES
    (v_car[1], v_tenant, 'carrier', 'Demo Line S.A.',       v_owner),
    (v_car[2], v_tenant, 'carrier', 'Atlantic Cargo Corp',  v_owner),
    (v_car[3], v_tenant, 'carrier', 'Caribbean Freight',    v_owner),
    (v_car[4], v_tenant, 'carrier', 'Pacific Logistics Inc',v_owner),
    (v_car[5], v_tenant, 'carrier', 'Island Shipping Ltd',  v_owner)
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 6. Clientes ficticios (kind='customer')
  -- ══════════════════════════════════════════════════════════════════════════════
  INSERT INTO public.accounts (id, tenant_id, kind, name, created_by)
  VALUES
    (v_cust[1], v_tenant, 'customer', 'Comercial Torres SRL',    v_owner),
    (v_cust[2], v_tenant, 'customer', 'Importadora del Sur',     v_owner),
    (v_cust[3], v_tenant, 'customer', 'Grupo Almonte & Hijos',   v_owner),
    (v_cust[4], v_tenant, 'customer', 'Distribuidora Pérez',     v_owner),
    (v_cust[5], v_tenant, 'customer', 'Manufactura Caribe',      v_owner),
    (v_cust[6], v_tenant, 'customer', 'Exportaciones Sánchez',   v_owner),
    (v_cust[7], v_tenant, 'customer', 'Tech Import RD',          v_owner),
    (v_cust[8], v_tenant, 'customer', 'Alimentos Nacionales SRL',v_owner)
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 7. Etapas del proceso (idempotente)
  -- ══════════════════════════════════════════════════════════════════════════════
  PERFORM public.seed_stage_definitions(v_tenant);

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 8. Contadores del tenant (para numeración)
  -- ══════════════════════════════════════════════════════════════════════════════
  INSERT INTO public.tenant_counters (tenant_id, key, value)
  VALUES
    (v_tenant, 'quotes',                 100),
    (v_tenant, 'shipments',              100),
    (v_tenant, 'shipments_mar_import',   100),
    (v_tenant, 'shipments_mar_export',   100),
    (v_tenant, 'shipments_aire_import',  100),
    (v_tenant, 'shipments_aire_export',  100),
    (v_tenant, 'shipments_aduana',       100),
    (v_tenant, 'shipments_transporte',   100),
    (v_tenant, 'pre_invoices',           100)
  ON CONFLICT DO NOTHING;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 9. Embarques (60 total, 10 por mes, Jun–Nov 2026)
  --    service_type rota por v_n % 6
  --    stage basado en recencia del mes
  --    ETA/ATA para reporte de puntualidad:
  --      - Meses 0-1 (Jun-Jul), v_i=1..4: ata = eta + 5 (entregado_tarde)
  --      - Meses 0-1 (Jun-Jul), v_i=5..10: ata = eta - 1 (a tiempo)
  --      - Meses 2-3 (Aug-Sep), activos: eta en el pasado (eta_vencida)
  --      - Mes 4 (Oct), v_i=1..4: eta = pasado (eta_vencida)
  -- ══════════════════════════════════════════════════════════════════════════════
  v_n := 0;
  FOR v_month IN 0..5 LOOP
    FOR v_i IN 1..10 LOOP
      v_n := v_n + 1;
      v_ship_id := ('dddd0005-0000-0000-0000-' || LPAD(v_n::text, 12, '0'))::uuid;

      -- Fecha de creación: día 1+v_i de cada mes
      v_created := ('2026-06-01'::date
        + (v_month || ' months')::interval
        + ((v_i - 1) || ' days')::interval)::timestamptz;

      -- service_type rotativo
      v_stype := v_service_arr[(v_n % 6) + 1];

      -- mode y direction según tipo
      v_mode := CASE v_stype
        WHEN 'mar_import'    THEN 'ocean'
        WHEN 'mar_export'    THEN 'ocean'
        WHEN 'aire_import'   THEN 'air'
        WHEN 'aire_export'   THEN 'air'
        ELSE NULL
      END;
      v_direction := CASE v_stype
        WHEN 'mar_import'    THEN 'import'
        WHEN 'mar_export'    THEN 'export'
        WHEN 'aire_import'   THEN 'import'
        WHEN 'aire_export'   THEN 'export'
        ELSE NULL
      END;

      -- Carrier rotativo
      v_carrier := v_car[(v_n % 5) + 1];

      -- Cliente rotativo
      v_customer := v_cust[(v_n % 8) + 1];

      -- Stage según mes
      v_stage := CASE
        WHEN v_month <= 1                              THEN 'delivered'
        WHEN v_month = 2 AND v_i <= 7                 THEN 'delivered'
        WHEN v_month = 2 AND v_i > 7                  THEN 'at_destination'
        WHEN v_month = 3                               THEN 'in_transit'
        WHEN v_month = 4 AND v_i <= 5                 THEN 'booked'
        WHEN v_month = 4 AND v_i > 5                  THEN 'in_transit'
        ELSE 'booked'
      END;

      -- ETA: 20 días después de creación para meses 0-3; futuro para 4-5
      v_eta := CASE
        WHEN v_month <= 3 THEN (v_created + '20 days'::interval)::date
        WHEN v_month = 4  THEN (CURRENT_DATE + ((v_i - 5) * 10 || ' days')::interval)::date
        ELSE (CURRENT_DATE + '30 days'::interval)::date
      END;

      -- ATA: solo para entregas
      v_ata := CASE
        WHEN v_stage IN ('delivered', 'completed') AND v_month <= 1 AND v_i <= 4
          THEN v_eta + 5   -- entregado con 5 días de retraso
        WHEN v_stage IN ('delivered', 'completed')
          THEN v_eta - 1   -- entregado a tiempo
        ELSE NULL
      END;

      INSERT INTO public.shipments (
        id, tenant_id, number, account_id,
        mode, direction, service_type,
        stage_key,
        origin_port_id, destination_port_id,
        carrier_account_id,
        eta, ata,
        cargo_description,
        created_by, created_at, updated_at
      ) VALUES (
        v_ship_id,
        v_tenant,
        'DEMO-' || LPAD(v_n::text, 4, '0'),
        v_customer,
        v_mode,
        v_direction,
        v_stype,
        v_stage,
        v_port_orig[(v_n % 6) + 1],
        v_port_dest[(v_n % 6) + 1],
        CASE WHEN v_stype NOT IN ('aduana','transporte') THEN v_carrier ELSE NULL END,
        v_eta,
        v_ata,
        'Carga demo ' || v_stype,
        v_owner,
        v_created,
        v_created
      ) ON CONFLICT DO NOTHING;

    END LOOP;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 10. Cargos de venta — 3 cargos para los primeros 50 embarques
  --     Cargo 1: flete (USD, sin ITBIS)
  --     Cargo 2: thc_destino (USD, sin ITBIS)
  --     Cargo 3: aduana / Gestión aduanal (DOP, 18% ITBIS)
  --     IDs: dddd0008-… LPAD(cargo_index, 12)
  --          cargo_index = (v_n - 1) * 3 + 1/2/3
  -- ══════════════════════════════════════════════════════════════════════════════
  FOR v_n IN 1..50 LOOP
    v_ship_id := ('dddd0005-0000-0000-0000-' || LPAD(v_n::text, 12, '0'))::uuid;
    v_charge1  := ('dddd0008-0000-0000-0000-' || LPAD(((v_n - 1) * 3 + 1)::text, 12, '0'))::uuid;
    v_charge2  := ('dddd0008-0000-0000-0000-' || LPAD(((v_n - 1) * 3 + 2)::text, 12, '0'))::uuid;
    v_charge3  := ('dddd0008-0000-0000-0000-' || LPAD(((v_n - 1) * 3 + 3)::text, 12, '0'))::uuid;

    INSERT INTO public.shipment_charges (
      id, tenant_id, shipment_id, charge_type_id,
      description, quantity, unit, unit_price, currency, tax_rate,
      sort_order, created_by
    ) VALUES
      (v_charge1, v_tenant, v_ship_id, 'flete',
       'Flete marítimo/aéreo', 1, 'flat',
       1200 + (v_n % 5) * 100,
       'USD', 0, 1, v_owner),
      (v_charge2, v_tenant, v_ship_id, 'thc_destino',
       'THC destino', 1, 'container',
       280 + (v_n % 3) * 20,
       'USD', 0, 2, v_owner),
      (v_charge3, v_tenant, v_ship_id, 'aduana',
       'Gestión aduanal', 1, 'flat',
       15000 + (v_n % 4) * 2500,
       'DOP', 0.18, 3, v_owner)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 11. Costos internos — 2 costos para los primeros 35 embarques
  --     (flete y thc_destino; el cargo de aduana no tiene costo registrado)
  --     Sin can_see_costs → SUM(scc.unit_cost * sc.quantity) = NULL → costo = 0
  -- ══════════════════════════════════════════════════════════════════════════════
  FOR v_n IN 1..35 LOOP
    v_charge1 := ('dddd0008-0000-0000-0000-' || LPAD(((v_n - 1) * 3 + 1)::text, 12, '0'))::uuid;
    v_charge2 := ('dddd0008-0000-0000-0000-' || LPAD(((v_n - 1) * 3 + 2)::text, 12, '0'))::uuid;

    INSERT INTO public.shipment_charge_costs (
      shipment_charge_id, tenant_id, unit_cost, currency
    ) VALUES
      (v_charge1, v_tenant, 950 + (v_n % 5) * 80,  'USD'),
      (v_charge2, v_tenant, 180 + (v_n % 3) * 15,  'USD')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ══════════════════════════════════════════════════════════════════════════════
  -- 12. Cotizaciones (42 total, 7 por mes, Jun–Nov 2026)
  --     Distribución de effective_status para el embudo:
  --       Meses 0-2 (Jun-Aug): converted(2) accepted(1) sent-expired(2) rejected(1) draft(1)
  --       Meses 3-4 (Sep-Oct): converted(1) accepted(2) sent-current(3) draft(1)
  --       Mes 5 (Nov):         accepted(2) sent-current(3) draft(2)
  --     'sent-expired': status='sent', valid_until = pasado (→ effective_status='expired')
  --     'sent-current': status='sent', valid_until = futuro
  -- ══════════════════════════════════════════════════════════════════════════════
  v_n := 0;
  FOR v_month IN 0..5 LOOP
    FOR v_i IN 1..7 LOOP
      v_n := v_n + 1;

      v_created := ('2026-06-05'::date
        + (v_month || ' months')::interval
        + ((v_i - 1) * 3 || ' days')::interval)::timestamptz;

      -- Determinar status y valid_until
      IF v_month <= 2 THEN
        CASE v_i
          WHEN 1, 2 THEN v_qstatus := 'converted'; v_vuntil := NULL;
          WHEN 3    THEN v_qstatus := 'accepted';   v_vuntil := NULL;
          WHEN 4, 5 THEN v_qstatus := 'sent';
                         v_vuntil := (v_created + '15 days'::interval)::date; -- pasado → expired
          WHEN 6    THEN v_qstatus := 'rejected';   v_vuntil := NULL;
          ELSE           v_qstatus := 'draft';       v_vuntil := NULL;
        END CASE;
      ELSIF v_month <= 4 THEN
        CASE v_i
          WHEN 1    THEN v_qstatus := 'converted'; v_vuntil := NULL;
          WHEN 2, 3 THEN v_qstatus := 'accepted';  v_vuntil := NULL;
          WHEN 4, 5, 6 THEN v_qstatus := 'sent';
                            v_vuntil := (CURRENT_DATE + '45 days'::interval)::date;
          ELSE           v_qstatus := 'draft';      v_vuntil := NULL;
        END CASE;
      ELSE -- mes 5 (Nov)
        CASE v_i
          WHEN 1, 2 THEN v_qstatus := 'accepted';  v_vuntil := NULL;
          WHEN 3, 4, 5 THEN v_qstatus := 'sent';
                            v_vuntil := (CURRENT_DATE + '60 days'::interval)::date;
          ELSE           v_qstatus := 'draft';      v_vuntil := NULL;
        END CASE;
      END IF;

      INSERT INTO public.quotes (
        id, tenant_id, number, account_id,
        service_type, status, valid_until, currency,
        notes, created_by, created_at, updated_at
      ) VALUES (
        ('dddd0006-0000-0000-0000-' || LPAD(v_n::text, 12, '0'))::uuid,
        v_tenant,
        'DEMO-COT-' || LPAD(v_n::text, 4, '0'),
        v_cust[(v_n % 8) + 1],
        v_service_arr[(v_n % 6) + 1],
        v_qstatus,
        v_vuntil,
        'USD',
        NULL,
        v_owner,
        v_created,
        v_created
      ) ON CONFLICT DO NOTHING;

    END LOOP;
  END LOOP;

END;
$$;
