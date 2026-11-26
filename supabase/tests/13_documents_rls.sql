-- 13_documents_rls.sql
-- Verificaciones de seguridad del módulo de documentos y correos (Fase F).
-- Requisito: correr después de 0020_documents.sql aplicada.

-- ── T1: RLS habilitado en las 3 tablas nuevas ─────────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('document_templates'), ('shipment_documents'), ('outbound_emails')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tname AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS no activado en tabla: %', tname;
    END IF;
  END LOOP;
  RAISE NOTICE 'T1 OK: RLS activo en document_templates, shipment_documents, outbound_emails';
END $$;

-- ── T2: Tablas de negocio nuevas tienen tenant_id ─────────────────────────────
DO $$
DECLARE
  tname text;
BEGIN
  FOR tname IN
    VALUES ('document_templates'), ('shipment_documents'), ('outbound_emails')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tname AND column_name = 'tenant_id'
    ) THEN
      RAISE EXCEPTION 'Tabla sin tenant_id: %', tname;
    END IF;
  END LOOP;
  RAISE NOTICE 'T2 OK: tenant_id presente en las 3 tablas';
END $$;

-- ── T3: Anónimo no ve filas en ninguna de las 3 tablas ───────────────────────
-- Acepta tanto "0 filas devueltas por RLS" como "permission denied" (aún más restrictivo).
DO $$
DECLARE
  cnt integer;
  tname text;
BEGIN
  SET LOCAL ROLE anon;

  FOR tname IN VALUES ('document_templates'),('shipment_documents'),('outbound_emails') LOOP
    BEGIN
      EXECUTE format('SELECT COUNT(*) FROM public.%I', tname) INTO cnt;
      IF cnt > 0 THEN
        RAISE EXCEPTION 'T3 FAIL: anon ve % filas en %', cnt, tname;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      -- "permission denied" = el rol anon no tiene ni acceso a la tabla; aún mejor que 0 filas.
      NULL;
    END;
  END LOOP;

  RAISE NOTICE 'T3 OK: anon no accede a ninguna tabla nueva (0 filas o permission denied)';
END $$;

-- ── T4: outbound_emails es append-only (UPDATE y DELETE tienen triggers bloqueadores) ────────
DO $$
DECLARE
  trigger_count integer;
BEGIN
  -- Busca triggers activos en outbound_emails que llamen a private.deny_mutation
  -- (cubre nombres como oe_no_update, oe_no_delete, deny_*, etc.)
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c    ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p     ON p.oid = t.tgfoid
  JOIN pg_namespace np ON np.oid = p.pronamespace
  WHERE n.nspname  = 'public'
    AND c.relname  = 'outbound_emails'
    AND t.tgenabled != 'D'
    AND np.nspname = 'private'
    AND p.proname  = 'deny_mutation';

  IF trigger_count < 2 THEN
    RAISE EXCEPTION 'T4 FAIL: outbound_emails necesita al menos 2 triggers deny_mutation (UPDATE+DELETE), encontrados: %', trigger_count;
  END IF;
  RAISE NOTICE 'T4 OK: outbound_emails tiene % triggers deny_mutation (append-only)', trigger_count;
END $$;

-- ── T5: Solo owner/admin puede editar document_templates ──────────────────────
DO $$
BEGIN
  -- Verificar que existe política de UPDATE restringida a owner/admin
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'document_templates'
      AND cmd        = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'T5 FAIL: no hay política UPDATE en document_templates';
  END IF;

  -- Verificar que la política menciona owner o admin
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'document_templates'
      AND cmd        = 'UPDATE'
      AND (qual ILIKE '%owner%' OR qual ILIKE '%admin%')
  ) THEN
    RAISE EXCEPTION 'T5 FAIL: política UPDATE de document_templates no restringe a owner/admin';
  END IF;

  RAISE NOTICE 'T5 OK: UPDATE de document_templates restringido a owner/admin';
END $$;

-- ── T6: shipment_documents filtra scan_status = quarantined ──────────────────
DO $$
BEGIN
  -- Verificar que la política SELECT menciona scan_status
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'shipment_documents'
      AND cmd        = 'SELECT'
      AND (qual ILIKE '%scan_status%' OR with_check ILIKE '%scan_status%')
  ) THEN
    RAISE EXCEPTION 'T6 FAIL: política SELECT de shipment_documents no filtra por scan_status';
  END IF;

  RAISE NOTICE 'T6 OK: SELECT de shipment_documents filtra por scan_status';
END $$;

-- ── T7: scan_status solo acepta valores válidos ───────────────────────────────
-- Usa pg_constraint en lugar de information_schema (más fiable en Supabase hosted).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel  ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid  = rel.relnamespace
    WHERE n.nspname  = 'public'
      AND rel.relname = 'shipment_documents'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%scan_status%'
  ) THEN
    RAISE EXCEPTION 'T7 FAIL: sin CHECK constraint en shipment_documents.scan_status';
  END IF;
  RAISE NOTICE 'T7 OK: scan_status tiene CHECK constraint';
END $$;
