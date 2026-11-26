-- 0007_search_accounts_rpc.sql
-- RPC parametrizada para búsqueda de cuentas.
-- Reemplaza la búsqueda dinámica que armaba .or() con texto del usuario.

CREATE OR REPLACE FUNCTION public.search_accounts(
  _tenant uuid,
  _q      text    DEFAULT '',
  _kind   text    DEFAULT '',
  _limit  int     DEFAULT 50
) RETURNS TABLE (
  id     uuid,
  kind   text,
  name   text,
  tax_id text,
  email  text,
  phone  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.id, a.kind, a.name, a.tax_id, a.email, a.phone
  FROM public.accounts a
  WHERE a.tenant_id = _tenant
    AND private.is_member(_tenant)
    AND (_kind = '' OR a.kind = _kind)
    AND (
      _q = ''
      OR a.name   ILIKE '%' || _q || '%'
      OR a.tax_id ILIKE '%' || _q || '%'
      OR a.email  ILIKE '%' || _q || '%'
      OR a.phone  ILIKE '%' || _q || '%'
    )
  ORDER BY a.name
  LIMIT _limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_accounts(uuid, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_accounts(uuid, text, text, int) TO authenticated;
