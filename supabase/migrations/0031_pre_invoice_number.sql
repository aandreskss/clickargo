-- 0031_pre_invoice_number.sql
-- AJ1: Número de prefactura compuesto — cotización + embarque.
-- Regla de negocio confirmada: "BXCT-000001/BXTGME-000002". Sin contador propio.
-- Contenido:
--   1. RENAME pre_invoices.number → number_legacy (preserva datos existentes)
--   2. ADD COLUMN number text (nullable inicialmente)
--   3. DROP + RECREATE create_pre_invoice derivando el número internamente
--   4. Backfill: pre_invoices con number_legacy hereda ese valor
--   5. ALTER TABLE: number NOT NULL

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Preservar numeración anterior
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pre_invoices RENAME COLUMN number TO number_legacy;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Nueva columna number (texto libre, derivado)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pre_invoices ADD COLUMN number text;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. DROP + RECREATE create_pre_invoice
--    Cambio: el número ya no viene de next_number('pre_invoices','PF-').
--    Se deriva del número del embarque + cotización vinculada:
--      - Ambos: "BXCT-000001/BXTGME-000002"
--      - Solo embarque: "BXTGME-000002"
--      - Solo cotización (raro): "BXCT-000001"
--    Los cargos deben pertenecer a un único embarque dentro de una misma
--    prefactura (restricción operativa); si hubiera varios, se usa el primero
--    en orden de creación.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_pre_invoice(uuid, uuid[], text, numeric);

CREATE OR REPLACE FUNCTION public.create_pre_invoice(
  _tenant          uuid,
  _charge_ids      uuid[],
  _notes           text    DEFAULT NULL,
  _exchange_rate   numeric DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_pre_invoice_id  uuid;
  v_number          text;
  v_account_id      uuid;
  v_currency        char(3);
  v_shipment_id     uuid;
  v_quote_id        uuid;
  v_shipment_num    text;
  v_quote_num       text;
  v_subtotal        numeric(14,2) := 0;
  v_tax_total       numeric(14,2) := 0;
  v_total           numeric(14,2) := 0;
  v_charge          record;
  v_line_subtotal   numeric(14,2);
  v_line_tax        numeric(14,2);
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin','finance']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _charge_ids IS NULL OR array_length(_charge_ids, 1) = 0 THEN
    RAISE EXCEPTION 'cargos_obligatorios';
  END IF;

  -- Obtener cuenta y moneda de los cargos
  SELECT DISTINCT sc.bill_to_account_id, sc.currency
    INTO v_account_id, v_currency
  FROM public.shipment_charges sc
  WHERE sc.id = ANY(_charge_ids) AND sc.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'cargos_no_encontrados'; END IF;

  -- Verificar que ningún cargo ya tenga prefactura
  IF (SELECT COUNT(*) FROM public.shipment_charges
      WHERE id = ANY(_charge_ids) AND tenant_id = _tenant AND pre_invoice_id IS NULL
     ) != array_length(_charge_ids, 1)
  THEN
    RAISE EXCEPTION 'cargo_bloqueado_prefactura: uno o más cargos ya tienen prefactura asignada';
  END IF;

  -- Derivar número compuesto desde el primer embarque de los cargos
  SELECT sc.shipment_id INTO v_shipment_id
  FROM public.shipment_charges sc
  WHERE sc.id = ANY(_charge_ids) AND sc.tenant_id = _tenant
  ORDER BY sc.created_at
  LIMIT 1;

  IF v_shipment_id IS NOT NULL THEN
    SELECT s.number, s.quote_id INTO v_shipment_num, v_quote_id
    FROM public.shipments s
    WHERE s.id = v_shipment_id;
  END IF;

  IF v_quote_id IS NOT NULL THEN
    SELECT q.number INTO v_quote_num
    FROM public.quotes q
    WHERE q.id = v_quote_id;
  END IF;

  -- Componer el número
  IF v_quote_num IS NOT NULL AND v_shipment_num IS NOT NULL THEN
    v_number := v_quote_num || '/' || v_shipment_num;
  ELSIF v_shipment_num IS NOT NULL THEN
    v_number := v_shipment_num;
  ELSIF v_quote_num IS NOT NULL THEN
    v_number := v_quote_num;
  ELSE
    -- Fallback: generar con contador (no debería ocurrir operativamente)
    v_number := public.next_number(_tenant, 'pre_invoices', 'PF-');
  END IF;

  -- Insertar prefactura
  INSERT INTO public.pre_invoices (
    tenant_id, number, number_legacy, account_id, status, currency,
    subtotal, tax_total, total, exchange_rate, notes, created_by
  ) VALUES (
    _tenant, v_number, v_number, v_account_id, 'draft', v_currency,
    0, 0, 0, _exchange_rate, _notes, auth.uid()
  )
  RETURNING id INTO v_pre_invoice_id;

  -- Insertar líneas (snapshot de los cargos)
  FOR v_charge IN
    SELECT sc.*, ct.code AS ct_code
    FROM public.shipment_charges sc
    JOIN public.charge_types ct ON ct.code = sc.charge_type_id
    WHERE sc.id = ANY(_charge_ids) AND sc.tenant_id = _tenant
    ORDER BY sc.sort_order, sc.created_at
  LOOP
    v_line_subtotal := ROUND((v_charge.quantity * v_charge.unit_price)::numeric, 2);
    v_line_tax      := ROUND((v_line_subtotal * v_charge.tax_rate)::numeric, 2);
    INSERT INTO public.pre_invoice_lines (
      pre_invoice_id, tenant_id,
      shipment_charge_id, shipment_id,
      charge_type_code, description,
      quantity, unit, unit_price, currency, tax_rate,
      subtotal, tax_amount, total, sort_order
    ) VALUES (
      v_pre_invoice_id, _tenant,
      v_charge.id, v_charge.shipment_id,
      v_charge.ct_code, v_charge.description,
      v_charge.quantity, v_charge.unit, v_charge.unit_price,
      v_charge.currency, v_charge.tax_rate,
      v_line_subtotal, v_line_tax,
      ROUND((v_line_subtotal + v_line_tax)::numeric, 2),
      v_charge.sort_order
    );
    v_subtotal  := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_line_tax;
  END LOOP;

  v_total := ROUND((v_subtotal + v_tax_total)::numeric, 2);
  UPDATE public.pre_invoices
  SET subtotal = ROUND(v_subtotal, 2), tax_total = ROUND(v_tax_total, 2),
      total = v_total, status = 'ready'
  WHERE id = v_pre_invoice_id;

  -- Vincular cargos a la prefactura
  UPDATE public.shipment_charges
  SET pre_invoice_id = v_pre_invoice_id
  WHERE id = ANY(_charge_ids) AND tenant_id = _tenant;

  RETURN v_pre_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_pre_invoice(uuid, uuid[], text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.create_pre_invoice(uuid, uuid[], text, numeric) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Backfill: prefacturas existentes heredan su number_legacy como number
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE public.pre_invoices
SET number = number_legacy
WHERE number IS NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Aplicar NOT NULL ahora que todos los rows tienen valor
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pre_invoices ALTER COLUMN number SET NOT NULL;

-- Mantener UNIQUE en la nueva columna (la restricción anterior era sobre number_legacy)
ALTER TABLE public.pre_invoices DROP CONSTRAINT IF EXISTS pre_invoices_tenant_id_number_key;
ALTER TABLE public.pre_invoices ADD CONSTRAINT pre_invoices_tenant_number_key
  UNIQUE (tenant_id, number);
