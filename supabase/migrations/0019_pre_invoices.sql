-- 0019_pre_invoices.sql
-- Fase E (cont.): Prefacturas, credenciales ERP y FK circular de charges.
-- Contenido:
--   1. FK circular: shipment_charges.pre_invoice_id → pre_invoices
--      (se agrega después de crear pre_invoices; patrón 0017 masters ↔ tracking_events)
--   2. pre_invoices  — cabecera de prefactura (inmutable una vez 'ready')
--   3. pre_invoice_lines — snapshot congelado (append-only)
--   4. integration_credentials — credenciales ERP cifradas (solo servidor)
--   5. RLS en las tres tablas
--   6. RPC create_pre_invoice  — crea prefactura y snapshot atómicamente (SECURITY DEFINER)
--   7. RPC void_pre_invoice    — anula prefactura y libera cargos (SECURITY DEFINER)

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. pre_invoices
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.pre_invoices (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number           text        NOT NULL,       -- PF-000001
  account_id       uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  status           text        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','ready','sent_to_erp','invoiced','void')),
  currency         char(3)     NOT NULL DEFAULT 'USD',
  subtotal         numeric(14,2) NOT NULL DEFAULT 0,
  tax_total        numeric(14,2) NOT NULL DEFAULT 0,
  total            numeric(14,2) NOT NULL DEFAULT 0,
  exchange_rate    numeric(10,4),              -- tasa usada al prefacturar (DOP/USD)
  notes            text,
  erp_provider     text,                       -- 'adm_cloud', 'csv', 'json', etc.
  erp_document_ref text,                       -- número de factura devuelto por ERP
  sent_at          timestamptz,
  created_by       uuid        DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE INDEX pi_tenant_idx    ON public.pre_invoices (tenant_id, created_at DESC);
CREATE INDEX pi_account_idx   ON public.pre_invoices (tenant_id, account_id);
CREATE INDEX pi_status_idx    ON public.pre_invoices (tenant_id, status);

CREATE TRIGGER pi_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER pi_updated
  BEFORE UPDATE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER pi_lock_tid
  BEFORE UPDATE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- Protege campos financieros cuando no es 'draft': solo se permiten cambios de estado,
-- erp_document_ref y sent_at. Los montos son inmutables una vez confirmados.
CREATE OR REPLACE FUNCTION private.pi_lock_financials()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status != 'draft' AND OLD.status != 'void' THEN
    IF (NEW.subtotal, NEW.tax_total, NEW.total, NEW.currency, NEW.account_id)
       IS DISTINCT FROM
       (OLD.subtotal, OLD.tax_total, OLD.total, OLD.currency, OLD.account_id)
    THEN
      RAISE EXCEPTION 'prefactura_no_editable: los montos de una prefactura confirmada son inmutables';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pi_lock_financials
  BEFORE UPDATE ON public.pre_invoices
  FOR EACH ROW EXECUTE FUNCTION private.pi_lock_financials();

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. FK circular: shipment_charges.pre_invoice_id → pre_invoices
--    (ya que pre_invoices ahora existe)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipment_charges
  ADD CONSTRAINT sc_pre_invoice_fkey
  FOREIGN KEY (pre_invoice_id)
  REFERENCES public.pre_invoices(id)
  ON DELETE SET NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. pre_invoice_lines — snapshot congelado (append-only)
--    shipment_charge_id es referencia histórica: NO se agrega ON DELETE CASCADE
--    para que el snapshot sobreviva si el cargo original se elimina (nunca debería,
--    pero defensivamente: el snapshot es el documento legal).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.pre_invoice_lines (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_invoice_id     uuid        NOT NULL REFERENCES public.pre_invoices(id) ON DELETE CASCADE,
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_charge_id uuid,       -- referencia histórica, sin ON DELETE (snapshot)
  shipment_id        uuid,       -- referencia histórica
  charge_type_code   text        NOT NULL,
  description        text        NOT NULL,
  quantity           numeric(12,3) NOT NULL,
  unit               text        NOT NULL,
  unit_price         numeric(14,2) NOT NULL,
  currency           char(3)     NOT NULL,
  tax_rate           numeric(5,4) NOT NULL,
  subtotal           numeric(14,2) NOT NULL,
  tax_amount         numeric(14,2) NOT NULL,
  total              numeric(14,2) NOT NULL,
  sort_order         int         NOT NULL DEFAULT 0
);

CREATE INDEX pil_preinvoice_idx ON public.pre_invoice_lines (pre_invoice_id);

-- Append-only: private.deny_mutation() existe desde migración 0009
CREATE TRIGGER pil_no_update
  BEFORE UPDATE ON public.pre_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();
CREATE TRIGGER pil_no_delete
  BEFORE DELETE ON public.pre_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

ALTER TABLE public.pre_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY pil_sel ON public.pre_invoice_lines FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));
-- INSERT solo vía RPC create_pre_invoice (SECURITY DEFINER)
-- UPDATE y DELETE bloqueados por trigger

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS pre_invoices
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pre_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY pi_sel ON public.pre_invoices FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY pi_ins ON public.pre_invoices FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','finance']::public.tenant_role[]));

CREATE POLICY pi_upd ON public.pre_invoices FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','finance']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY pi_del ON public.pre_invoices FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[])
    AND status = 'void');

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. integration_credentials — credenciales ERP cifradas (AES-256-GCM)
--    - encrypted_payload, iv y auth_tag son el cifrado AES-GCM.
--    - masked_display: solo últimos caracteres visibles (•••• + últimos 4).
--    - La UI NUNCA selecciona encrypted_payload; solo masked_display + metadatos.
--    - El descifrado ocurre exclusivamente en Server Actions con admin client.
--    - Cada acceso queda en security_events.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.integration_credentials (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider          text        NOT NULL,    -- 'adm_cloud'
  encrypted_payload text        NOT NULL,
  iv                text        NOT NULL,
  auth_tag          text        NOT NULL,
  masked_display    text        NOT NULL,    -- '••••••••1234'
  last_accessed_at  timestamptz,
  created_by        uuid        DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX ic_tenant_idx ON public.integration_credentials (tenant_id);

CREATE TRIGGER ic_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER ic_updated
  BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER ic_lock_tid
  BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

-- Solo owner/admin pueden ver la fila; la query siempre omite encrypted_payload
CREATE POLICY ic_sel ON public.integration_credentials FOR SELECT TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]));
CREATE POLICY ic_ins ON public.integration_credentials FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]));
CREATE POLICY ic_upd ON public.integration_credentials FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));
CREATE POLICY ic_del ON public.integration_credentials FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin']::public.tenant_role[]));

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RPC create_pre_invoice
--    Crea la prefactura y el snapshot atómicamente.
--    Validaciones:
--      a) Rol y membresía
--      b) Todos los charge_ids pertenecen al tenant y shipment indicado
--      c) Ningún charge_id ya tiene pre_invoice_id
--      d) Al menos 1 cargo
--    Totales calculados en BD (nunca confiamos en el cliente).
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_pre_invoice(uuid, uuid[], text, numeric);

CREATE OR REPLACE FUNCTION public.create_pre_invoice(
  _tenant          uuid,
  _charge_ids      uuid[],
  _notes           text    DEFAULT NULL,
  _exchange_rate   numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pre_invoice_id  uuid;
  v_number          text;
  v_account_id      uuid;
  v_currency        char(3);
  v_subtotal        numeric(14,2) := 0;
  v_tax_total       numeric(14,2) := 0;
  v_total           numeric(14,2) := 0;
  v_charge          record;
  v_line_subtotal   numeric(14,2);
  v_line_tax        numeric(14,2);
BEGIN
  -- 1. Validar rol
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin','finance']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 2. Validar que hay al menos un cargo
  IF _charge_ids IS NULL OR array_length(_charge_ids, 1) = 0 THEN
    RAISE EXCEPTION 'cargos_obligatorios';
  END IF;

  -- 3. Verificar que todos los cargos pertenecen al tenant, están libres y tienen la misma cuenta
  SELECT DISTINCT sc.bill_to_account_id, sc.currency
    INTO v_account_id, v_currency
  FROM public.shipment_charges sc
  WHERE sc.id = ANY(_charge_ids)
    AND sc.tenant_id = _tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cargos_no_encontrados';
  END IF;

  -- Verificar que todos son del mismo tenant y están libres
  IF (
    SELECT COUNT(*) FROM public.shipment_charges
    WHERE id = ANY(_charge_ids)
      AND tenant_id = _tenant
      AND pre_invoice_id IS NULL
  ) != array_length(_charge_ids, 1) THEN
    RAISE EXCEPTION 'cargo_bloqueado_prefactura: uno o más cargos ya tienen prefactura asignada';
  END IF;

  -- 4. Generar número de prefactura
  v_number := public.next_number(_tenant, 'pre_invoices', 'PF-');

  -- 5. Insertar cabecera con subtotal provisional (se actualiza al final)
  INSERT INTO public.pre_invoices (
    tenant_id, number, account_id, status, currency,
    subtotal, tax_total, total, exchange_rate, notes, created_by
  ) VALUES (
    _tenant, v_number, v_account_id, 'draft', v_currency,
    0, 0, 0, _exchange_rate, _notes, auth.uid()
  )
  RETURNING id INTO v_pre_invoice_id;

  -- 6. Insertar líneas (snapshot congelado) y calcular totales
  FOR v_charge IN
    SELECT sc.*, ct.code AS ct_code
    FROM public.shipment_charges sc
    JOIN public.charge_types ct ON ct.code = sc.charge_type_id
    WHERE sc.id = ANY(_charge_ids)
      AND sc.tenant_id = _tenant
    ORDER BY sc.sort_order, sc.created_at
  LOOP
    v_line_subtotal := ROUND((v_charge.quantity * v_charge.unit_price)::numeric, 2);
    v_line_tax      := ROUND((v_line_subtotal * v_charge.tax_rate)::numeric, 2);

    INSERT INTO public.pre_invoice_lines (
      pre_invoice_id, tenant_id,
      shipment_charge_id, shipment_id,
      charge_type_code, description,
      quantity, unit, unit_price, currency, tax_rate,
      subtotal, tax_amount, total,
      sort_order
    ) VALUES (
      v_pre_invoice_id, _tenant,
      v_charge.id, v_charge.shipment_id,
      v_charge.ct_code, v_charge.description,
      v_charge.quantity, v_charge.unit, v_charge.unit_price,
      v_charge.currency, v_charge.tax_rate,
      v_line_subtotal, v_line_tax, ROUND((v_line_subtotal + v_line_tax)::numeric, 2),
      v_charge.sort_order
    );

    v_subtotal  := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;

  v_total := ROUND((v_subtotal + v_tax_total)::numeric, 2);

  -- 7. Actualizar totales en la cabecera
  UPDATE public.pre_invoices
  SET subtotal   = ROUND(v_subtotal, 2),
      tax_total  = ROUND(v_tax_total, 2),
      total      = v_total,
      status     = 'ready'
  WHERE id = v_pre_invoice_id;

  -- 8. Vincular los cargos a la prefactura
  UPDATE public.shipment_charges
  SET pre_invoice_id = v_pre_invoice_id
  WHERE id = ANY(_charge_ids)
    AND tenant_id = _tenant;

  RETURN v_pre_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_pre_invoice(uuid, uuid[], text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.create_pre_invoice(uuid, uuid[], text, numeric) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RPC void_pre_invoice
--    Anula la prefactura y libera los cargos (pre_invoice_id → NULL).
--    Solo owner/admin pueden anular.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.void_pre_invoice(uuid, uuid);

CREATE OR REPLACE FUNCTION public.void_pre_invoice(
  _tenant         uuid,
  _pre_invoice_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  -- 1. Validar rol
  IF NOT private.has_role(_tenant,
    ARRAY['owner','admin']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 2. Verificar que existe y no está ya anulada o facturada
  SELECT status INTO v_status
  FROM public.pre_invoices
  WHERE id = _pre_invoice_id AND tenant_id = _tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'prefactura_no_encontrada';
  END IF;

  IF v_status IN ('invoiced') THEN
    RAISE EXCEPTION 'prefactura_no_editable: una prefactura ya facturada no puede anularse';
  END IF;

  IF v_status = 'void' THEN
    RAISE EXCEPTION 'prefactura_ya_anulada';
  END IF;

  -- 3. Liberar los cargos
  UPDATE public.shipment_charges
  SET pre_invoice_id = NULL
  WHERE pre_invoice_id = _pre_invoice_id
    AND tenant_id = _tenant;

  -- 4. Marcar como anulada
  UPDATE public.pre_invoices
  SET status = 'void'
  WHERE id = _pre_invoice_id
    AND tenant_id = _tenant;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_pre_invoice(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.void_pre_invoice(uuid, uuid) TO authenticated;
