-- 0032_reports.sql
-- Fase I: Vistas SQL para los 4 reportes operativos.
-- Todas usan security_invoker = true para que la RLS de las tablas subyacentes
-- se aplique al usuario que ejecuta la consulta (no al definer).
-- Las vistas de rentabilidad heredan automáticamente la restricción can_see_costs
-- de shipment_charge_costs.
-- Contenido:
--   1. Índices de rendimiento nuevos
--   2. report_embarques_por_mes  — conteo por etapa/modo/mes
--   3. report_puntualidad        — retraso por naviera
--   4. report_embudo             — funnel de cotizaciones por mes/vendedor
--   5. report_rentabilidad       — venta/costo/margen por embarque
--   6. GRANTs para authenticated
--   7. log_report_export()       — RPC wrapper para insertar en security_events

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Índices de rendimiento (IF NOT EXISTS para idempotencia)
-- ══════════════════════════════════════════════════════════════════════════════

-- Puntualidad: búsqueda por naviera
CREATE INDEX IF NOT EXISTS idx_shipments_carrier
  ON public.shipments (tenant_id, carrier_account_id)
  WHERE carrier_account_id IS NOT NULL;

-- Embudo: filtrar cotizaciones por vendedor y estado
CREATE INDEX IF NOT EXISTS idx_quotes_created_by_status
  ON public.quotes (tenant_id, created_by, status);

-- Embarques: filtrar por service_type (modo avanzado de AJ1)
CREATE INDEX IF NOT EXISTS idx_shipments_service_type
  ON public.shipments (tenant_id, service_type)
  WHERE service_type IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. report_embarques_por_mes
--    Conteo de embarques agrupado por mes, etapa, modo, dirección, service_type
--    y cliente. Permite filtros PostgREST encadenados desde la capa TypeScript.
--    'America/Santo_Domingo' = UTC-4 sin DST (zona fija de Box To Go).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE VIEW public.report_embarques_por_mes WITH (security_invoker = true) AS
SELECT
  s.tenant_id,
  date_trunc('month', s.created_at AT TIME ZONE 'America/Santo_Domingo')::date AS mes,
  s.stage_key,
  s.mode,
  s.direction,
  s.service_type,
  s.account_id,
  COUNT(*)::int AS conteo
FROM public.shipments s
GROUP BY
  s.tenant_id,
  date_trunc('month', s.created_at AT TIME ZONE 'America/Santo_Domingo'),
  s.stage_key,
  s.mode,
  s.direction,
  s.service_type,
  s.account_id;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. report_puntualidad
--    Un row por embarque que tenga ETA. Incluye naviera (LEFT JOIN accounts),
--    días de retraso si ata > eta, y bandera eta_vencida para los que están
--    activos con ETA pasada.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE VIEW public.report_puntualidad WITH (security_invoker = true) AS
SELECT
  s.tenant_id,
  s.id                                                               AS shipment_id,
  s.number,
  s.carrier_account_id                                              AS carrier_id,
  ca.name                                                           AS naviera,
  s.mode,
  s.eta,
  s.ata,
  s.stage_key,
  date_trunc('month', s.created_at AT TIME ZONE 'America/Santo_Domingo')::date AS mes,
  CASE
    WHEN s.ata IS NOT NULL AND s.eta IS NOT NULL AND s.ata > s.eta
    THEN (s.ata - s.eta)
    ELSE NULL
  END::int                                                          AS dias_retraso,
  CASE
    WHEN s.ata IS NOT NULL AND s.eta IS NOT NULL AND s.ata > s.eta
    THEN true
    ELSE false
  END                                                               AS entregado_tarde,
  CASE
    WHEN s.eta < CURRENT_DATE
      AND s.stage_key NOT IN ('delivered', 'completed', 'cancelled')
    THEN true
    ELSE false
  END                                                               AS eta_vencida
FROM public.shipments s
LEFT JOIN public.accounts ca ON ca.id = s.carrier_account_id
WHERE s.eta IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. report_embudo
--    Un row por cotización. effective_status recalcula 'sent' vencidas como
--    'expired' (misma lógica que quote_totals). Se une a profiles para obtener
--    el nombre del vendedor (created_by).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE VIEW public.report_embudo WITH (security_invoker = true) AS
SELECT
  q.tenant_id,
  q.id                                                              AS quote_id,
  date_trunc('month', q.created_at AT TIME ZONE 'America/Santo_Domingo')::date AS mes,
  q.service_type,
  CASE
    WHEN q.status = 'sent'
      AND q.valid_until IS NOT NULL
      AND q.valid_until < CURRENT_DATE
    THEN 'expired'
    ELSE q.status
  END                                                               AS effective_status,
  q.created_by,
  p.full_name                                                       AS vendedor
FROM public.quotes q
LEFT JOIN public.profiles p ON p.id = q.created_by;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. report_rentabilidad
--    Agrega cargos de venta y costos internos por embarque.
--    security_invoker = true: la RLS de shipment_charge_costs aplica al usuario
--    que consulta. Sin can_see_costs → SUM(scc.unit_cost * sc.quantity) = NULL
--    → COALESCE(..., 0) = 0. La capa de aplicación (página + API) bloquea
--    adicionalmente el acceso al reporte completo para usuarios sin can_see_costs.
--    Patrón idéntico a shipment_margin (0018_charges.sql).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE VIEW public.report_rentabilidad WITH (security_invoker = true) AS
SELECT
  s.tenant_id,
  s.id                                                              AS shipment_id,
  s.number                                                          AS embarque,
  date_trunc('month', s.created_at AT TIME ZONE 'America/Santo_Domingo')::date AS mes,
  s.account_id,
  a.name                                                            AS cliente,
  s.origin_port_id,
  s.destination_port_id,
  s.mode,
  s.service_type,
  ROUND(COALESCE(SUM(sc.quantity * sc.unit_price), 0)::numeric, 2) AS venta,
  ROUND(COALESCE(SUM(scc.unit_cost * sc.quantity), 0)::numeric, 2) AS costo,
  ROUND(
    (COALESCE(SUM(sc.quantity * sc.unit_price), 0)
      - COALESCE(SUM(scc.unit_cost * sc.quantity), 0))::numeric,
  2)                                                                AS margen,
  CASE
    WHEN COALESCE(SUM(sc.quantity * sc.unit_price), 0) > 0
    THEN ROUND(
      ((COALESCE(SUM(sc.quantity * sc.unit_price), 0)
          - COALESCE(SUM(scc.unit_cost * sc.quantity), 0))
        / NULLIF(COALESCE(SUM(sc.quantity * sc.unit_price), 0), 0) * 100)::numeric,
    1)
    ELSE 0::numeric
  END                                                               AS margen_pct
FROM public.shipment_charges sc
JOIN  public.shipments              s   ON s.id  = sc.shipment_id
JOIN  public.accounts               a   ON a.id  = s.account_id
LEFT JOIN public.shipment_charge_costs scc ON scc.shipment_charge_id = sc.id
GROUP BY
  s.tenant_id,
  s.id,
  s.number,
  date_trunc('month', s.created_at AT TIME ZONE 'America/Santo_Domingo'),
  s.account_id,
  a.name,
  s.origin_port_id,
  s.destination_port_id,
  s.mode,
  s.service_type;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. GRANTs — acceso de lectura a usuarios autenticados
--    La RLS de las tablas subyacentes (via security_invoker) ya filtra por tenant.
-- ══════════════════════════════════════════════════════════════════════════════

GRANT SELECT ON public.report_embarques_por_mes TO authenticated;
GRANT SELECT ON public.report_puntualidad        TO authenticated;
GRANT SELECT ON public.report_embudo             TO authenticated;
GRANT SELECT ON public.report_rentabilidad       TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. log_report_export — wrapper público sobre private.log_security_event
--    Permite que la API route registre exportaciones sin usar service_role.
--    Valida membresía antes de insertar (mínimo privilegio).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_report_export(
  _tenant uuid,
  _report text,
  _meta   jsonb DEFAULT '{}'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_member(_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM private.log_security_event(
    _tenant,
    'export_report',
    jsonb_build_object('report', _report) || _meta
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_report_export(uuid, text, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.log_report_export(uuid, text, jsonb) TO authenticated;
