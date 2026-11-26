-- 0009_append_only_enforcement.sql
-- Protección extra para las tablas de auditoría: triggers que bloquean UPDATE y DELETE.
-- La RLS ya niega INSERT/UPDATE/DELETE desde el cliente; esto añade una segunda barrera
-- que funciona incluso si alguien tiene acceso directo con el rol postgres.

CREATE OR REPLACE FUNCTION private.deny_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Esta tabla es de solo escritura (append-only). No se permite modificar ni eliminar registros.';
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

CREATE TRIGGER sec_events_no_update
  BEFORE UPDATE ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

CREATE TRIGGER sec_events_no_delete
  BEFORE DELETE ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();
