-- 03_append_only.sql
-- Verifica que audit_log y security_events son append-only.
-- Intenta hacer DELETE (debe fallar con la excepción del trigger).

DO $$
DECLARE
  v_error text;
BEGIN
  -- Prueba: DELETE en audit_log debe fallar.
  BEGIN
    DELETE FROM public.audit_log WHERE id = -1; -- id que no existe, igual debe disparar el trigger
    RAISE EXCEPTION 'FALLA: DELETE en audit_log debería haber lanzado una excepción.';
  EXCEPTION
    WHEN OTHERS THEN
      v_error := SQLERRM;
      IF v_error LIKE '%append-only%' OR v_error LIKE '%solo escritura%' THEN
        RAISE NOTICE 'OK: audit_log bloquea DELETE correctamente.';
      ELSE
        RAISE EXCEPTION 'audit_log lanzó un error inesperado: %', v_error;
      END IF;
  END;

  -- Prueba: DELETE en security_events debe fallar.
  BEGIN
    DELETE FROM public.security_events WHERE id = -1;
    RAISE EXCEPTION 'FALLA: DELETE en security_events debería haber lanzado una excepción.';
  EXCEPTION
    WHEN OTHERS THEN
      v_error := SQLERRM;
      IF v_error LIKE '%append-only%' OR v_error LIKE '%solo escritura%' THEN
        RAISE NOTICE 'OK: security_events bloquea DELETE correctamente.';
      ELSE
        RAISE EXCEPTION 'security_events lanzó un error inesperado: %', v_error;
      END IF;
  END;
END;
$$;
