-- 0027_shipment_enhancements.sql
-- AJ1: Mejoras a la tabla shipments.
-- Contenido:
--   1. ADD origin_agent_account_id — agente de origen del embarque
--   2. ADD hbl_issued_by — indica si el HBL/HAWB lo emitimos nosotros o el agente
--   3. ADD customs_managed + customs_user_id — asignación de gestión aduanal
--   4. DROP + RECREATE política SELECT de shipments para customs_broker
--      El customs_broker solo ve los embarques donde customs_managed=true
--      y customs_user_id = auth.uid().

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Agente de origen
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD COLUMN origin_agent_account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.shipments.origin_agent_account_id IS
  'Agente de origen (account con kind=agent). Obligatorio operativamente pero opcional en BD.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Origen del HBL/HAWB
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD COLUMN hbl_issued_by text CHECK (hbl_issued_by IN ('us', 'origin_agent'));

COMMENT ON COLUMN public.shipments.hbl_issued_by IS
  'us = lo emite la empresa; origin_agent = se recibe del agente de origen con su numeración.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Gestión aduanal en destino
--    customs_managed: casilla "lleva gestión aduanal en destino"
--    customs_user_id: el miembro con rol customs_broker asignado a este embarque
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD COLUMN customs_managed boolean NOT NULL DEFAULT false;

ALTER TABLE public.shipments
  ADD COLUMN customs_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.shipments.customs_managed IS
  'TRUE = este embarque lleva gestión aduanal en destino.';
COMMENT ON COLUMN public.shipments.customs_user_id IS
  'ID del usuario con rol customs_broker asignado a gestionar la aduana de este embarque.';

CREATE INDEX shipments_customs_idx ON public.shipments (customs_user_id)
  WHERE customs_managed = true;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Actualizar política SELECT de shipments para customs_broker
--
--    La política actual (shipments_sel) permite a CUALQUIER miembro ver TODOS
--    los embarques del tenant (private.is_member). Esto incluye al customs_broker
--    que hoy ve embarques que no le corresponden.
--
--    Nueva regla:
--    - Roles estándar (owner → viewer, excepto customs_broker): ven todo.
--    - customs_broker: solo ve embarques donde
--        customs_managed = true AND customs_user_id = auth.uid()
--    - customer (portal): manejado por políticas de portal (0023) — no cambia.
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS shipments_sel ON public.shipments;

CREATE POLICY shipments_sel ON public.shipments FOR SELECT TO authenticated
  USING (
    -- Roles de staff con visibilidad completa
    private.has_role(tenant_id,
      ARRAY['owner','admin','manager','operator','finance','sales','viewer']::public.tenant_role[])
    OR
    -- customs_broker: solo sus embarques asignados con gestión aduanal activa
    (
      private.has_role(tenant_id, ARRAY['customs_broker']::public.tenant_role[])
      AND customs_managed = true
      AND customs_user_id = auth.uid()
    )
  );

-- La política del portal (customer via tracking_links / portal_invitations)
-- se maneja en 0022_portal_role y 0023_portal_tables: accede vía RPC
-- get_tracking_shipment() (anon, SECURITY DEFINER), no vía RLS directa.
-- Por eso no es necesario incluir 'customer' aquí.
