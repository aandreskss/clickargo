-- 0005_invite_expiry_and_reserved_slugs.sql
-- Invitaciones con expiración (7 días), slugs reservados y validación en BD.

-- ── 1. Expiración de invitaciones ───────────────────────────────────────────────
ALTER TABLE public.tenant_invites
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days');

-- ── 2. Slugs reservados ─────────────────────────────────────────────────────────
CREATE TABLE public.reserved_slugs (
  slug text PRIMARY KEY
);
ALTER TABLE public.reserved_slugs ENABLE ROW LEVEL SECURITY;

-- Solo superadmin puede leer; nadie inserta/modifica desde el cliente.
CREATE POLICY reserved_slugs_select ON public.reserved_slugs FOR SELECT TO authenticated
  USING (private.is_superadmin());

INSERT INTO public.reserved_slugs (slug) VALUES
  ('www'), ('app'), ('api'), ('admin'), ('mail'), ('status'),
  ('soporte'), ('support'), ('static'), ('assets'), ('cdn'), ('media'),
  ('blog'), ('docs'), ('help'), ('auth'), ('login'), ('registro'),
  ('monitoring'), ('health'), ('webhook'), ('webhooks'), ('ws'),
  ('socket'), ('realtime'), ('storage'), ('rpc'), ('rest'), ('graphql'),
  ('dashboard'), ('panel'), ('billing'), ('payment'), ('checkout');

-- ── 3. Trigger de validación de slug en tenants ──────────────────────────────────
CREATE OR REPLACE FUNCTION private.validate_tenant_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reserved_slugs WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'reservado: el subdominio "%" está reservado', NEW.slug;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_check_slug
  BEFORE INSERT OR UPDATE OF slug ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION private.validate_tenant_slug();

-- ── 4. Actualizar admin_create_tenant para rechazar slugs reservados ──────────────
-- (el trigger lo haría igualmente, pero el mensaje del trigger es menos legible)
CREATE OR REPLACE FUNCTION public.admin_create_tenant(
  _slug text, _name text, _country char(2), _owner_email text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  tid uuid;
  uid uuid;
  loc text; tz text;
BEGIN
  IF NOT private.is_superadmin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF EXISTS (SELECT 1 FROM public.reserved_slugs WHERE slug = lower(_slug)) THEN
    RAISE EXCEPTION 'reservado: ese subdominio está reservado';
  END IF;

  IF upper(_country) = 'US' THEN loc := 'en-US'; tz := 'America/New_York';
  ELSE loc := 'es-DO'; tz := 'America/Santo_Domingo'; END IF;

  INSERT INTO public.tenants (slug, name, country, locale, timezone, trial_ends_at)
  VALUES (lower(_slug), _name, upper(_country), loc, tz, now() + interval '14 days')
  RETURNING id INTO tid;

  SELECT u.id INTO uid FROM auth.users u WHERE lower(u.email) = lower(_owner_email) LIMIT 1;
  IF uid IS NOT NULL THEN
    INSERT INTO public.memberships (tenant_id, user_id, role, can_see_costs)
    VALUES (tid, uid, 'owner', true);
  ELSE
    INSERT INTO public.tenant_invites (tenant_id, email, role)
    VALUES (tid, lower(_owner_email), 'owner');
  END IF;

  RETURN tid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_tenant(text, text, char, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_create_tenant(text, text, char, text) TO authenticated;

-- ── 5. Actualizar handle_new_user para filtrar invitaciones vencidas ──────────────
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)));

  -- Solo asignar membresías de invitaciones válidas (no vencidas).
  INSERT INTO public.memberships (tenant_id, user_id, role, can_see_costs)
  SELECT i.tenant_id, NEW.id, i.role, i.role IN ('owner','admin','finance')
  FROM public.tenant_invites i
  WHERE lower(i.email) = lower(NEW.email)
    AND (i.expires_at IS NULL OR i.expires_at > now())
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  -- Limpiar TODAS las invitaciones del correo (vencidas o no).
  DELETE FROM public.tenant_invites WHERE lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

-- ── 6. Limpieza de invitaciones vencidas (llamar desde cron o manualmente) ────────
CREATE OR REPLACE FUNCTION private.cleanup_expired_invites()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  DELETE FROM public.tenant_invites WHERE expires_at < now();
$$;
