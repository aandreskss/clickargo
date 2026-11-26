-- 0006_closed_registration_hook.sql
-- Hook de Supabase Auth para bloquear registros sin invitación válida.
-- ACCIÓN MANUAL REQUERIDA: registrar esta función en Supabase Auth → Hooks →
-- "Before User Created" → Postgres Function → private.hook_before_user_created

CREATE OR REPLACE FUNCTION private.hook_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_email text;
BEGIN
  user_email := lower(event->'user'->>'email');

  -- Permitir si existe invitación válida y no vencida.
  IF EXISTS (
    SELECT 1 FROM public.tenant_invites
    WHERE lower(email) = user_email
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN jsonb_build_object('decision', 'continue');
  END IF;

  RETURN jsonb_build_object(
    'decision', 'reject',
    'message',  'Registro solo por invitación válida.'
  );
END;
$$;

-- El hook lo llama el sistema de auth; necesita EXECUTE para el rol que usa Supabase.
GRANT EXECUTE ON FUNCTION private.hook_before_user_created(jsonb) TO supabase_auth_admin;
