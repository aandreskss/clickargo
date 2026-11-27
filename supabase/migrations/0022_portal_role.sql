-- 0022_portal_role.sql
-- Fase H: Portal del cliente – modelo de roles y seguridad
--
-- DECISIÓN CLAVE: actualizamos private.is_member() para excluir 'customer',
-- de modo que ALL las políticas y RPCs existentes que usan is_member() bloqueen
-- automáticamente a clientes del portal sin tener que tocar cada objeto.
-- Luego agregamos políticas customer-específicas solo donde corresponde.
--
-- IDEMPOTENTE: se puede re-ejecutar sin errores.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. COLUMNA account_id en memberships ─────────────────────────────────────
-- NOTA: 'customer' se agrega al enum en 0022_portal_enum.sql (transacción previa).

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS account_id uuid
    REFERENCES public.accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS m_customer_has_account;
ALTER TABLE public.memberships
  ADD CONSTRAINT m_customer_has_account
    CHECK (role != 'customer' OR account_id IS NOT NULL);

-- ── 2. ACTUALIZAR is_member: excluir rol 'customer' ──────────────────────────
-- Esto hace que TODAS las políticas/RPCs existentes bloqueen a customers.
-- Los accesos permitidos al cliente del portal se definen en políticas separadas.

CREATE OR REPLACE FUNCTION private.is_member(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = _tenant
      AND m.user_id   = auth.uid()
      AND m.is_active = true
      AND m.role     != 'customer'
  );
$$;

-- ── 3. NUEVAS FUNCIONES HELPER ────────────────────────────────────────────────

-- is_staff: alias de is_member (para nuevo código, semántica más clara)
CREATE OR REPLACE FUNCTION private.is_staff(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.is_member(_tenant); $$;

-- is_customer: usuario tiene membresía activa de tipo 'customer' en este tenant
CREATE OR REPLACE FUNCTION private.is_customer(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = _tenant
      AND m.user_id   = auth.uid()
      AND m.is_active = true
      AND m.role      = 'customer'
  );
$$;

-- customer_account_id: retorna el account_id del cliente (NULL si no es customer)
CREATE OR REPLACE FUNCTION private.customer_account_id(_tenant uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.account_id
  FROM public.memberships m
  WHERE m.tenant_id = _tenant
    AND m.user_id   = auth.uid()
    AND m.is_active = true
    AND m.role      = 'customer'
  LIMIT 1;
$$;

-- ── 4. POLÍTICAS RLS ADICIONALES PARA CUSTOMERS ───────────────────────────────
-- Las políticas existentes con is_member ahora excluyen customers (ver paso 2).
-- Aquí solo agregamos los accesos permitidos al cliente del portal.

DROP POLICY IF EXISTS memberships_customer_sel ON public.memberships;
CREATE POLICY memberships_customer_sel ON public.memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND role = 'customer');

DROP POLICY IF EXISTS accounts_customer_sel ON public.accounts;
CREATE POLICY accounts_customer_sel ON public.accounts FOR SELECT TO authenticated
  USING (
    private.is_customer(tenant_id)
    AND id = private.customer_account_id(tenant_id)
  );

DROP POLICY IF EXISTS stage_defs_customer_sel ON public.stage_definitions;
CREATE POLICY stage_defs_customer_sel ON public.stage_definitions FOR SELECT TO authenticated
  USING (private.is_customer(tenant_id));

DROP POLICY IF EXISTS shipments_customer_sel ON public.shipments;
CREATE POLICY shipments_customer_sel ON public.shipments FOR SELECT TO authenticated
  USING (
    private.is_customer(tenant_id)
    AND account_id = private.customer_account_id(tenant_id)
  );

DROP POLICY IF EXISTS events_customer_sel ON public.shipment_events;
CREATE POLICY events_customer_sel ON public.shipment_events FOR SELECT TO authenticated
  USING (
    visible_to_customer = true
    AND EXISTS (
      SELECT 1 FROM public.shipments s
      WHERE s.id         = shipment_events.shipment_id
        AND s.account_id = private.customer_account_id(s.tenant_id)
        AND private.is_customer(s.tenant_id)
    )
  );

DROP POLICY IF EXISTS sd_customer_sel ON public.shipment_documents;
CREATE POLICY sd_customer_sel ON public.shipment_documents FOR SELECT TO authenticated
  USING (
    visible_to_customer = true
    AND scan_status      = 'clean'
    AND shipment_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.shipments s
      WHERE s.id         = shipment_documents.shipment_id
        AND s.account_id = private.customer_account_id(s.tenant_id)
        AND private.is_customer(s.tenant_id)
    )
  );

-- ── 5. ACTUALIZAR POLÍTICA DE PERFILES ───────────────────────────────────────
-- Un customer solo ve su propio perfil, no los de miembros del staff.

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.memberships a
      JOIN public.memberships b ON a.tenant_id = b.tenant_id
      WHERE a.user_id = auth.uid()
        AND b.user_id = profiles.id
        AND a.role   != 'customer'
    )
  );

-- ── 6. STORAGE: documentos accesibles al customer ────────────────────────────
-- La política existente "tenant members can view documents" ya usa is_member()
-- que ahora excluye customers. Agregamos política adicional para customers.

DROP POLICY IF EXISTS "customers can view their documents" ON storage.objects;
CREATE POLICY "customers can view their documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND private.is_customer(((storage.foldername(name))[1])::uuid)
    AND EXISTS (
      SELECT 1 FROM public.shipment_documents sd
      JOIN public.shipments s ON s.id = sd.shipment_id
      WHERE sd.storage_path         = storage.objects.name
        AND sd.visible_to_customer  = true
        AND sd.scan_status          = 'clean'
        AND s.account_id = private.customer_account_id(((storage.foldername(name))[1])::uuid)
    )
  );

-- ── 7. ACTUALIZAR list_team_members: excluir customers ───────────────────────

CREATE OR REPLACE FUNCTION public.list_team_members(_tenant uuid)
RETURNS TABLE (
  membership_id uuid,
  user_id       uuid,
  full_name     text,
  email         text,
  role          public.tenant_role,
  can_see_costs boolean,
  is_active     boolean,
  created_at    timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.user_id,
    p.full_name,
    u.email::text,
    m.role,
    m.can_see_costs,
    m.is_active,
    m.created_at
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  JOIN auth.users u       ON u.id = m.user_id
  WHERE m.tenant_id = _tenant
    AND m.role      != 'customer'
  ORDER BY m.is_active DESC, m.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_team_members(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.list_team_members(uuid) TO authenticated;

-- ── 8. AJUSTAR outbound_emails para correos del sistema (cron) ───────────────

ALTER TABLE public.outbound_emails
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.outbound_emails
  DROP CONSTRAINT IF EXISTS outbound_emails_template_check;
ALTER TABLE public.outbound_emails
  ADD CONSTRAINT outbound_emails_template_check
    CHECK (template IN ('quote','arrival_notice','pre_invoice','notification'));

-- ── 9. TABLA portal_invitations ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.portal_invitations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id  uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  token_hash  text        NOT NULL UNIQUE,
  invited_by  uuid        REFERENCES auth.users(id),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pi_email_check CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE INDEX IF NOT EXISTS pi_tenant_idx ON public.portal_invitations (tenant_id, account_id);
CREATE INDEX IF NOT EXISTS pi_hash_idx   ON public.portal_invitations (token_hash);

DROP TRIGGER IF EXISTS pi_lock_tid ON public.portal_invitations;
CREATE TRIGGER pi_lock_tid
  BEFORE UPDATE ON public.portal_invitations
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

DROP TRIGGER IF EXISTS pi_audit ON public.portal_invitations;
CREATE TRIGGER pi_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.portal_invitations
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

ALTER TABLE public.portal_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pi_staff_sel ON public.portal_invitations;
CREATE POLICY pi_staff_sel ON public.portal_invitations FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

DROP POLICY IF EXISTS pi_insert ON public.portal_invitations;
CREATE POLICY pi_insert ON public.portal_invitations FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

DROP POLICY IF EXISTS pi_delete ON public.portal_invitations;
CREATE POLICY pi_delete ON public.portal_invitations FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));
-- Sin UPDATE por RLS (aceptación usa admin client con service_role)
