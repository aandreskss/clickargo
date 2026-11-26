-- 0011_quotes.sql
-- Módulo de cotizaciones: quotes, quote_lines (venta), quote_line_costs (costos internos).
-- SEGURIDAD: quote_line_costs exige can_see_costs = true. Nunca exponer costos a usuarios sin ese flag.

-- ───────────────────────── Tabla quotes ─────────────────────────
CREATE TABLE public.quotes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number       text NOT NULL,
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  service_type text NOT NULL
               CHECK (service_type IN ('mar_import','mar_export','aire_import')),
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','sent','accepted','expired','rejected')),
  origin       text,
  destination  text,
  currency     char(3) NOT NULL DEFAULT 'USD',
  notes        text,
  valid_until  date,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE INDEX quotes_tenant_idx ON public.quotes (tenant_id, created_at DESC);
CREATE INDEX quotes_account_idx ON public.quotes (tenant_id, account_id);
CREATE INDEX quotes_status_idx  ON public.quotes (tenant_id, status);

-- ───────────────────────── Tabla quote_lines ─────────────────────────
CREATE TABLE public.quote_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  quote_id     uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  service      text NOT NULL,
  qty          numeric(10,4) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  currency     char(3) NOT NULL DEFAULT 'USD',
  taxable      boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_lines_quote_idx ON public.quote_lines (quote_id);

-- ───────────────────────── Tabla quote_line_costs ─────────────────────────
-- RLS extra: solo usuarios con can_see_costs = true pueden acceder.
CREATE TABLE public.quote_line_costs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  quote_line_id uuid NOT NULL REFERENCES public.quote_lines(id) ON DELETE CASCADE,
  cost          numeric(12,2) NOT NULL CHECK (cost >= 0),
  currency      char(3) NOT NULL DEFAULT 'USD',
  vendor_id     uuid REFERENCES public.accounts(id),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_line_id)
);

-- ───────────────────────── Vista quote_totals ─────────────────────────
-- Solo sumas de VENTA. Nunca incluye datos de costs.
-- SECURITY INVOKER (default) → RLS de quotes y quote_lines se aplica automáticamente.
CREATE VIEW public.quote_totals AS
SELECT
  q.id AS quote_id,
  q.tenant_id,
  q.number,
  CASE
    WHEN q.status = 'sent'
     AND q.valid_until IS NOT NULL
     AND q.valid_until < CURRENT_DATE
    THEN 'expired' ELSE q.status
  END AS effective_status,
  q.currency,
  COALESCE(SUM(ql.qty * ql.unit_price), 0)                                        AS subtotal,
  COALESCE(SUM(CASE WHEN ql.taxable THEN ql.qty * ql.unit_price * 0.18 ELSE 0 END), 0) AS itbis,
  COALESCE(
    SUM(ql.qty * ql.unit_price)
    + SUM(CASE WHEN ql.taxable THEN ql.qty * ql.unit_price * 0.18 ELSE 0 END),
    0
  ) AS total_sale,
  COUNT(ql.id) AS line_count
FROM public.quotes q
LEFT JOIN public.quote_lines ql ON ql.quote_id = q.id
GROUP BY q.id, q.tenant_id, q.number, q.status, q.currency, q.valid_until;

-- ───────────────────────── Triggers ─────────────────────────

-- quotes
CREATE TRIGGER quotes_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER quotes_updated
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER quotes_lock_tid
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- quote_lines
CREATE TRIGGER ql_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER ql_updated
  BEFORE UPDATE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER ql_lock_tid
  BEFORE UPDATE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- quote_line_costs
CREATE TRIGGER qlc_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.quote_line_costs
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER qlc_updated
  BEFORE UPDATE ON public.quote_line_costs
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER qlc_lock_tid
  BEFORE UPDATE ON public.quote_line_costs
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ───────────────────────── RLS ─────────────────────────

ALTER TABLE public.quotes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_costs ENABLE ROW LEVEL SECURITY;

-- quotes: todo el equipo lee; operator/sales/manager/admin/owner escriben; manager+ borra.
CREATE POLICY quotes_sel ON public.quotes FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));
CREATE POLICY quotes_ins ON public.quotes FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','sales','operator']::public.tenant_role[]));
CREATE POLICY quotes_upd ON public.quotes FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','sales','operator']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));
CREATE POLICY quotes_del ON public.quotes FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- quote_lines: mismo conjunto de roles que quotes.
CREATE POLICY ql_sel ON public.quote_lines FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));
CREATE POLICY ql_ins ON public.quote_lines FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','sales','operator']::public.tenant_role[]));
CREATE POLICY ql_upd ON public.quote_lines FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','sales','operator']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));
CREATE POLICY ql_del ON public.quote_lines FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- quote_line_costs: requiere can_see_costs = true ADEMÁS del rol.
CREATE POLICY qlc_sel ON public.quote_line_costs FOR SELECT TO authenticated
  USING (
    private.is_member(tenant_id)
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = quote_line_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );
CREATE POLICY qlc_ins ON public.quote_line_costs FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(tenant_id,
      ARRAY['owner','admin','manager','finance']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = quote_line_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );
CREATE POLICY qlc_upd ON public.quote_line_costs FOR UPDATE TO authenticated
  USING (
    private.has_role(tenant_id,
      ARRAY['owner','admin','manager','finance']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = quote_line_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  )
  WITH CHECK (private.is_member(tenant_id));
CREATE POLICY qlc_del ON public.quote_line_costs FOR DELETE TO authenticated
  USING (
    private.has_role(tenant_id,
      ARRAY['owner','admin','manager']::public.tenant_role[])
    AND (
      SELECT m.can_see_costs FROM public.memberships m
      WHERE m.tenant_id = quote_line_costs.tenant_id AND m.user_id = auth.uid()
    ) = true
  );

-- ───────────────────────── RPC search_quotes ─────────────────────────
-- SECURITY DEFINER con search_path = '' y validación de membresía.
-- NO retorna ningún campo de costo.
CREATE OR REPLACE FUNCTION public.search_quotes(
  _tenant uuid,
  _q      text DEFAULT '',
  _status text DEFAULT '',
  _limit  int  DEFAULT 50
) RETURNS TABLE (
  id           uuid,
  number       text,
  account_id   uuid,
  account_name text,
  service_type text,
  status       text,
  currency     char(3),
  total_sale   numeric,
  valid_until  date,
  created_at   timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    q.id,
    q.number,
    q.account_id,
    a.name,
    q.service_type,
    CASE
      WHEN q.status = 'sent'
       AND q.valid_until IS NOT NULL
       AND q.valid_until < CURRENT_DATE
      THEN 'expired' ELSE q.status
    END,
    q.currency,
    COALESCE((
      SELECT SUM(ql.qty * ql.unit_price * (1 + CASE WHEN ql.taxable THEN 0.18 ELSE 0 END))
      FROM public.quote_lines ql WHERE ql.quote_id = q.id
    ), 0),
    q.valid_until,
    q.created_at
  FROM public.quotes q
  LEFT JOIN public.accounts a ON a.id = q.account_id
  WHERE q.tenant_id = _tenant
    AND private.is_member(_tenant)
    AND (_status = '' OR q.status = _status)
    AND (
      _q = ''
      OR q.number ILIKE '%' || _q || '%'
      OR a.name   ILIKE '%' || _q || '%'
    )
  ORDER BY q.created_at DESC
  LIMIT _limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_quotes(uuid, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_quotes(uuid, text, text, int) TO authenticated;

-- ───────────────────────── Revocar anon en tablas nuevas ─────────────────────────
REVOKE ALL ON TABLE public.quotes           FROM anon;
REVOKE ALL ON TABLE public.quote_lines      FROM anon;
REVOKE ALL ON TABLE public.quote_line_costs FROM anon;
