-- 0028_shipment_dates.sql
-- AJ1: Fechas operativas de aduana (importación) y exportación.
-- Contenido:
--   1. ADD 9 campos de aduana importación a shipments
--   2. ADD 5 campos de exportación a shipments
--   3. Función + trigger: al registrar igra_num + igra_date → etapa 'liberado'
--   4. ADD kind 'customs' a shipment_events si no existe (para los eventos IGRA)

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Campos de aduana para importación
--    Aplica a service_type IN ('mar_import','aire_import','aduana').
--    Todos nullable — no todos los embarques los completan.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD COLUMN declaracion_num        text,
  ADD COLUMN liquidacion_num        text,
  ADD COLUMN declaracion_date       date,
  ADD COLUMN arrival_manifest_date  date,
  ADD COLUMN verificacion_date      date,
  ADD COLUMN caja_request_date      date,
  ADD COLUMN igra_num               text,
  ADD COLUMN igra_date              date,
  ADD COLUMN despacho_date          date;

COMMENT ON COLUMN public.shipments.igra_num  IS
  'Número IGRA (solicitud final de despacho). Al registrarse junto con igra_date el embarque pasa a "liberado para entrega".';
COMMENT ON COLUMN public.shipments.igra_date IS
  'Fecha IGRA. Al registrarse junto con igra_num el trigger avanza la etapa a ''liberado''.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Campos de exportación
--    Aplica a service_type IN ('mar_export','aire_export').
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD COLUMN booking_date            date,
  ADD COLUMN container_cutoff_date   date,
  ADD COLUMN docs_cutoff_date        date,
  ADD COLUMN container_return_date   date,
  ADD COLUMN vgm_date                date;

COMMENT ON COLUMN public.shipments.docs_cutoff_date IS
  'Corte de documentación (instrucciones de embarque).';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Trigger IGRA → etapa 'liberado'
--    Cuando se registran AMBOS igra_num (texto no vacío) e igra_date (fecha),
--    el embarque avanza automáticamente a stage_key='liberado'.
--    Se registra un evento en shipment_events (kind='system').
--    El trigger corre AFTER UPDATE para que las FK de shipment_events ya sean válidas.
-- ══════════════════════════════════════════════════════════════════════════════

-- Extender el CHECK de kind en shipment_events para incluir 'customs'
ALTER TABLE public.shipment_events DROP CONSTRAINT IF EXISTS shipment_events_kind_check;
ALTER TABLE public.shipment_events ADD CONSTRAINT shipment_events_kind_check
  CHECK (kind IN ('stage_changed','eta_changed','note','document','tracking','system','customs'));

CREATE OR REPLACE FUNCTION private.shipment_igra_released()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Solo actuar cuando ambos campos acaban de ser llenados
  IF NEW.igra_num IS NOT NULL
     AND NEW.igra_num != ''
     AND NEW.igra_date IS NOT NULL
     AND (OLD.igra_num IS NULL OR OLD.igra_num = '' OR OLD.igra_date IS NULL)
     AND NEW.stage_key NOT IN ('completed', 'cancelled', 'liberado')
  THEN
    -- Usar UPDATE directo (dentro de AFTER trigger, mismo row ya fue guardado)
    UPDATE public.shipments
    SET stage_key  = 'liberado',
        updated_at = now()
    WHERE id = NEW.id;

    INSERT INTO public.shipment_events (
      tenant_id, shipment_id, kind, from_stage, to_stage,
      message, visible_to_customer, actor_id
    ) VALUES (
      NEW.tenant_id, NEW.id, 'customs', NEW.stage_key, 'liberado',
      'IGRA registrado (' || NEW.igra_num || '). Carga liberada para entrega.',
      true, auth.uid()
    );
  END IF;
  RETURN NULL; -- AFTER trigger, retorno ignorado
END;
$$;

CREATE TRIGGER shipment_igra_released
  AFTER UPDATE ON public.shipments
  FOR EACH ROW
  WHEN (NEW.igra_num IS DISTINCT FROM OLD.igra_num OR NEW.igra_date IS DISTINCT FROM OLD.igra_date)
  EXECUTE FUNCTION private.shipment_igra_released();

-- Asegurar que 'liberado' exista como etapa entre 'at_destination' (6) y
-- 'out_for_delivery' (7). Se renumeran las etapas 7-10 a 8-11 para hacer espacio.
-- Idempotente: el DO bloque verifica si 'liberado' ya existe antes de renumerar.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM public.stage_definitions
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.stage_definitions
      WHERE tenant_id = t.tenant_id AND key = 'liberado'
    ) THEN
      -- Desplazar las etapas con sort_order >= 7 para hacer espacio
      UPDATE public.stage_definitions
      SET sort_order = sort_order + 1
      WHERE tenant_id = t.tenant_id
        AND sort_order >= 7
        AND key IN ('out_for_delivery','delivered','completed','cancelled');

      INSERT INTO public.stage_definitions
        (tenant_id, key, label, name, sort_order, mode, direction, visible_to_customer, is_terminal)
      VALUES
        (t.tenant_id, 'liberado', 'Liberado para entrega', 'Liberado para entrega',
         7, 'both', 'both', true, false);
    END IF;
  END LOOP;
END;
$$;
