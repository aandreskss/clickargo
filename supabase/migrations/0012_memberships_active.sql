-- 0012_memberships_active.sql
-- Permite desactivar miembros sin eliminarlos.
-- Las funciones RLS is_member/has_role bloquean su acceso inmediatamente.
-- DEFAULT true: todos los miembros existentes quedan activos.

ALTER TABLE public.memberships
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- ── Recrear is_member con chequeo de is_active ───────────────────────────────
CREATE OR REPLACE FUNCTION private.is_member(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = _tenant
      AND m.user_id   = auth.uid()
      AND m.is_active = true
  );
$$;

-- ── Recrear has_role con chequeo de is_active ────────────────────────────────
CREATE OR REPLACE FUNCTION private.has_role(_tenant uuid, _roles public.tenant_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = _tenant
      AND m.user_id   = auth.uid()
      AND m.role      = ANY(_roles)
      AND m.is_active = true
  );
$$;

-- ── RPC para listar el equipo (incluye inactivos; solo owner/admin) ──────────
-- Junta memberships + profiles + auth.users para obtener email sin exponer la tabla.
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
  ORDER BY m.is_active DESC, m.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_team_members(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.list_team_members(uuid) TO authenticated;
