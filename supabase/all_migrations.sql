
-- ============================================================
-- 0001_core_multitenant.sql
-- ============================================================

-- 0001_core_multitenant.sql
-- Núcleo multi-tenant: empresas, membresías, roles, auditoría, numeración y RLS.
-- Regla de oro: toda tabla de negocio lleva tenant_id y RLS filtrando por membresía.

-- ───────────────────────── Esquema privado para helpers ─────────────────────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon;

-- ───────────────────────── Tipos ─────────────────────────
create type public.tenant_role as enum (
  'owner', 'admin', 'manager', 'operator', 'finance',
  'sales', 'customs_broker', 'viewer'
);

create type public.tenant_status as enum ('trial', 'active', 'suspended', 'cancelled');

-- ───────────────────────── Tablas núcleo ─────────────────────────
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$'),
  name        text not null,
  country     char(2) not null default 'DO',          -- paquete de campos por país
  locale      text not null default 'es-DO',
  currency    char(3) not null default 'USD',
  timezone    text not null default 'America/Santo_Domingo',
  plan        text not null default 'starter',
  status      public.tenant_status not null default 'trial',
  trial_ends_at timestamptz,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  locale        text not null default 'es-DO',
  is_superadmin boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.tenant_role not null default 'operator',
  can_see_costs boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  actor_id   uuid,
  table_name text not null,
  record_id  text,
  action     text not null,                            -- INSERT / UPDATE / DELETE
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

-- Numeración por empresa (cotizaciones, embarques, etc.): COT-000001, EMB-000001…
create table public.tenant_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key       text not null,
  value     bigint not null default 0,
  primary key (tenant_id, key)
);

-- Primera tabla de negocio (cuentas: clientes, proveedores, navieras, agentes).
-- Sirve de patrón para todas las demás y para las pruebas de aislamiento.
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  kind       text not null check (kind in ('customer','carrier','vendor','agent','other')),
  name       text not null,
  tax_id     text,                                     -- RNC en RD, EIN en US
  email      text,
  phone      text,
  data       jsonb not null default '{}'::jsonb,       -- campos por país (field_definitions)
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_tenant_idx on public.accounts (tenant_id, kind, name);

-- ───────────────────────── Funciones helper (RLS) ─────────────────────────
create or replace function private.is_superadmin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function private.is_member(_tenant uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = _tenant and m.user_id = auth.uid()
  );
$$;

create or replace function private.has_role(_tenant uuid, _roles public.tenant_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = _tenant and m.user_id = auth.uid() and m.role = any(_roles)
  );
$$;

-- Siguiente número consecutivo por empresa y clave (atómico).
create or replace function public.next_number(_tenant uuid, _key text, _prefix text default '')
returns text language plpgsql security definer set search_path = ''
as $$
declare n bigint;
begin
  if not private.is_member(_tenant) then
    raise exception 'not a member of tenant';
  end if;
  insert into public.tenant_counters as c (tenant_id, key, value)
  values (_tenant, _key, 1)
  on conflict (tenant_id, key) do update set value = c.value + 1
  returning value into n;
  return _prefix || lpad(n::text, 6, '0');
end;
$$;

-- Resolución de empresa por subdominio (la usa el middleware antes del login).
-- Expone solo lo mínimo.
create or replace function public.tenant_by_slug(_slug text)
returns table (id uuid, name text, country char(2), locale text, status public.tenant_status)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name, t.country, t.locale, t.status
  from public.tenants t where t.slug = lower(_slug);
$$;

-- Perfil automático al registrarse un usuario.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Auditoría genérica (se engancha a cada tabla de negocio).
create or replace function private.log_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare t uuid; rid text;
begin
  if tg_op = 'DELETE' then
    t := old.tenant_id; rid := old.id::text;
  else
    t := new.tenant_id; rid := new.id::text;
  end if;
  insert into public.audit_log (tenant_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (t, auth.uid(), tg_table_name, rid, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger accounts_audit after insert or update or delete on public.accounts
  for each row execute function private.log_change();
create trigger accounts_touch before update on public.accounts
  for each row execute function private.touch_updated_at();

-- Impide cambiar tenant_id de una fila (evita "mudar" datos a otra empresa).
create or replace function private.lock_tenant_id()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable';
  end if;
  return new;
end;
$$;
create trigger accounts_lock_tenant before update on public.accounts
  for each row execute function private.lock_tenant_id();

-- ───────────────────────── RLS ─────────────────────────
alter table public.tenants          enable row level security;
alter table public.profiles         enable row level security;
alter table public.memberships      enable row level security;
alter table public.audit_log        enable row level security;
alter table public.tenant_counters  enable row level security;
alter table public.accounts         enable row level security;

-- tenants: ver las propias; editar solo owner/admin; crear/borrar solo con service role.
create policy tenants_select on public.tenants for select to authenticated
  using (private.is_member(id) or private.is_superadmin());
create policy tenants_update on public.tenants for update to authenticated
  using (private.has_role(id, array['owner','admin']::public.tenant_role[]))
  with check (private.has_role(id, array['owner','admin']::public.tenant_role[]));

-- profiles: el propio y los de compañeros de empresa.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships a
      join public.memberships b on a.tenant_id = b.tenant_id
      where a.user_id = auth.uid() and b.user_id = profiles.id
    )
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- is_superadmin NO se puede modificar desde el cliente:
revoke update on public.profiles from authenticated;
grant update (full_name, locale) on public.profiles to authenticated;

-- memberships: ver las de mis empresas; gestionar solo owner/admin.
create policy memberships_select on public.memberships for select to authenticated
  using (private.is_member(tenant_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    private.has_role(tenant_id, array['owner','admin']::public.tenant_role[])
    and (role <> 'owner' or private.has_role(tenant_id, array['owner']::public.tenant_role[]))
  );
create policy memberships_update on public.memberships for update to authenticated
  using (private.has_role(tenant_id, array['owner','admin']::public.tenant_role[]))
  with check (
    private.has_role(tenant_id, array['owner','admin']::public.tenant_role[])
    and (role <> 'owner' or private.has_role(tenant_id, array['owner']::public.tenant_role[]))
  );
create policy memberships_delete on public.memberships for delete to authenticated
  using (private.has_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- audit_log: solo lectura para owner/admin; escribe únicamente el trigger.
create policy audit_select on public.audit_log for select to authenticated
  using (private.has_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- tenant_counters: sin acceso directo (se usa next_number()).
-- (RLS activado y sin políticas = denegado)

-- accounts: todo el equipo lee; escriben todos menos viewer; borra owner/admin/manager.
create policy accounts_select on public.accounts for select to authenticated
  using (private.is_member(tenant_id));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (private.has_role(tenant_id,
    array['owner','admin','manager','operator','finance','sales','customs_broker']::public.tenant_role[]));
create policy accounts_update on public.accounts for update to authenticated
  using (private.has_role(tenant_id,
    array['owner','admin','manager','operator','finance','sales','customs_broker']::public.tenant_role[]))
  with check (private.is_member(tenant_id));
create policy accounts_delete on public.accounts for delete to authenticated
  using (private.has_role(tenant_id, array['owner','admin','manager']::public.tenant_role[]));

-- ───────────────────────── Permisos de funciones ─────────────────────────
revoke execute on function public.next_number(uuid, text, text) from public, anon;
grant  execute on function public.next_number(uuid, text, text) to authenticated;
grant  execute on function public.tenant_by_slug(text) to anon, authenticated;



-- ============================================================
-- 0002_invites_and_admin.sql
-- ============================================================

-- 0002_invites_and_admin.sql
-- Invitaciones por correo y alta de empresas por el superadmin (sin service_role).

create table public.tenant_invites (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  email      text not null,
  role       public.tenant_role not null default 'operator',
  created_at timestamptz not null default now()
);
create unique index tenant_invites_lower_email on public.tenant_invites (tenant_id, lower(email));
alter table public.tenant_invites enable row level security;

create policy invites_select on public.tenant_invites for select to authenticated
  using (private.has_role(tenant_id, array['owner','admin']::public.tenant_role[]));
create policy invites_insert on public.tenant_invites for insert to authenticated
  with check (private.has_role(tenant_id, array['owner','admin']::public.tenant_role[])
    and (role <> 'owner' or private.has_role(tenant_id, array['owner']::public.tenant_role[])));
create policy invites_delete on public.tenant_invites for delete to authenticated
  using (private.has_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- Al registrarse, el usuario recibe automáticamente las membresías pendientes de su correo.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));

  insert into public.memberships (tenant_id, user_id, role, can_see_costs)
  select i.tenant_id, new.id, i.role, i.role in ('owner','admin','finance')
  from public.tenant_invites i
  where lower(i.email) = lower(new.email)
  on conflict (tenant_id, user_id) do nothing;

  delete from public.tenant_invites where lower(email) = lower(new.email);
  return new;
end;
$$;

-- Alta de empresa (solo superadmin). País define idioma, moneda y zona horaria.
create or replace function public.admin_create_tenant(
  _slug text, _name text, _country char(2), _owner_email text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  tid uuid;
  uid uuid;
  loc text; tz text;
begin
  if not private.is_superadmin() then
    raise exception 'forbidden';
  end if;

  if upper(_country) = 'US' then loc := 'en-US'; tz := 'America/New_York';
  else loc := 'es-DO'; tz := 'America/Santo_Domingo'; end if;

  insert into public.tenants (slug, name, country, locale, timezone, trial_ends_at)
  values (lower(_slug), _name, upper(_country), loc, tz, now() + interval '14 days')
  returning id into tid;

  select u.id into uid from auth.users u where lower(u.email) = lower(_owner_email) limit 1;
  if uid is not null then
    insert into public.memberships (tenant_id, user_id, role, can_see_costs)
    values (tid, uid, 'owner', true);
  else
    insert into public.tenant_invites (tenant_id, email, role)
    values (tid, lower(_owner_email), 'owner');
  end if;

  return tid;
end;
$$;

revoke execute on function public.admin_create_tenant(text, text, char, text) from public, anon;
grant  execute on function public.admin_create_tenant(text, text, char, text) to authenticated;



-- ============================================================
-- 0003_audit_skip_deleted_tenant.sql
-- ============================================================

-- 0003: permite borrar una empresa (cascada) sin que la auditoría falle por la FK.
create or replace function private.log_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare t uuid; rid text;
begin
  if tg_op = 'DELETE' then t := old.tenant_id; rid := old.id::text;
  else t := new.tenant_id; rid := new.id::text; end if;

  -- Si la empresa se está eliminando (cascada), no hay a quién auditar.
  if not exists (select 1 from public.tenants where id = t) then
    return null;
  end if;

  insert into public.audit_log (tenant_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (t, auth.uid(), tg_table_name, rid, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end;
$$;



-- ============================================================
-- 0004_security_events.sql
-- ============================================================

-- 0004_security_events.sql
-- Tabla append-only para registrar acciones sensibles (autenticación, cambios de rol, etc.).
-- Ningún cliente puede INSERT/UPDATE/DELETE; solo funciones SECURITY DEFINER escriben.

create table public.security_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid references public.tenants(id) on delete set null,
  actor_id   uuid,                          -- auth.uid() en el momento del evento
  event_type text not null,                 -- ver lista canónica en docs/SEGURIDAD.md
  metadata   jsonb not null default '{}',   -- datos relevantes (sin secretos ni PII extra)
  ip_address inet,
  created_at timestamptz not null default now()
);

create index sec_events_tenant_idx on public.security_events (tenant_id, created_at desc);
create index sec_events_type_idx   on public.security_events (event_type, created_at desc);

alter table public.security_events enable row level security;

-- Solo owner y admin pueden leer. Nadie puede escribir directamente.
create policy sec_events_select on public.security_events for select to authenticated
  using (private.has_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- Sin políticas de INSERT/UPDATE/DELETE → denegado desde el cliente.

-- ───────────────────────── Helper interno ─────────────────────────
-- Llamar desde otros SECURITY DEFINER cuando ocurra un evento auditable.
create or replace function private.log_security_event(
  _tenant    uuid,
  _type      text,
  _meta      jsonb default '{}'
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.security_events (tenant_id, actor_id, event_type, metadata)
  values (_tenant, auth.uid(), _type, _meta);
end;
$$;



-- ============================================================
-- 0005_invite_expiry_and_reserved_slugs.sql
-- ============================================================

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



-- ============================================================
-- 0006_closed_registration_hook.sql
-- ============================================================

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



-- ============================================================
-- 0007_search_accounts_rpc.sql
-- ============================================================

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



-- ============================================================
-- 0008_revoke_anon_privileges.sql
-- ============================================================

-- 0008_revoke_anon_privileges.sql
-- Mínimo privilegio para el rol anon: revocar acceso a todas las tablas,
-- secuencias y funciones del esquema public, luego otorgar solo lo estrictamente necesario.

-- Revocar acceso a todas las tablas actuales.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES  IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS  IN SCHEMA public FROM anon;

-- Revocar el privilegio por defecto de EXECUTE que PostgreSQL otorga a PUBLIC.
-- Esto afecta a las funciones creadas a partir de aquí.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL     ON TABLES    FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL     ON FUNCTIONS FROM anon;

-- Restaurar solo lo que anon necesita.
-- tenant_by_slug: necesaria para resolver la empresa desde el subdominio (antes del login).
GRANT EXECUTE ON FUNCTION public.tenant_by_slug(text) TO anon;



-- ============================================================
-- 0009_append_only_enforcement.sql
-- ============================================================

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



-- ============================================================
-- 0010_integration_credentials_schema.sql
-- ============================================================

-- 0010_integration_credentials_schema.sql
-- PLACEHOLDER: esquema para credenciales de integraciones. No usar hasta Fase F.
--
-- Cifrado: AES-256-GCM app-side.
-- La llave de cifrado vive en INTEGRATION_SECRET_KEY (variable de entorno, server-only).
-- El valor almacenado es: base64(nonce_12bytes || ciphertext || tag_16bytes).
-- La UI muestra solo los últimos 4 caracteres del valor descifrado, nunca el valor completo.
-- Cada lectura queda en security_events (event_type = 'credential_accessed').
-- Implementar en Fase F junto con src/lib/crypto.ts (AES-256-GCM)
-- y src/app/actions/integrations.ts.

CREATE TABLE public.integration_credentials (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider    text        NOT NULL,          -- 'adm_cloud', 'tracking_x', etc.
  label       text        NOT NULL,
  secret_enc  text        NOT NULL,          -- valor cifrado en la app (ver comentario arriba)
  created_by  uuid        DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

-- Solo owner y admin pueden leer sus propias credenciales.
CREATE POLICY integration_credentials_select ON public.integration_credentials FOR SELECT TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

-- Solo owner y admin pueden insertar/actualizar.
CREATE POLICY integration_credentials_insert ON public.integration_credentials FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY integration_credentials_update ON public.integration_credentials FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY integration_credentials_delete ON public.integration_credentials FOR DELETE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE TRIGGER integration_credentials_touch BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER integration_credentials_lock_tenant BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();



-- ============================================================
-- 0011_quotes.sql
-- ============================================================

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



-- ============================================================
-- 0012_memberships_active.sql
-- ============================================================

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



-- ============================================================
-- 0013_global_catalogs.sql
-- ============================================================

-- 0013_global_catalogs.sql
-- Catálogos globales de solo lectura: puertos, incoterms, tipos de contenedor.
-- Sin tenant_id. Legibles por cualquier usuario autenticado.
-- INSERT/UPDATE/DELETE explícitamente revocados.

-- ── Puertos (UN/LOCODE) ──────────────────────────────────────────────────────
CREATE TABLE public.ports (
  code        text    PRIMARY KEY,              -- UN/LOCODE, ej: DOPCM
  name        text    NOT NULL,
  country_code char(2) NOT NULL,
  type        text    NOT NULL CHECK (type IN ('sea','air','both')),
  is_featured boolean NOT NULL DEFAULT false    -- aparece primero en PortSelect
);

-- ── Incoterms 2020 ───────────────────────────────────────────────────────────
CREATE TABLE public.incoterms (
  code        text PRIMARY KEY,                 -- EXW, FOB, etc.
  name        text NOT NULL,
  description text
);

-- ── Tipos de contenedor ──────────────────────────────────────────────────────
CREATE TABLE public.container_types (
  code text    PRIMARY KEY,                     -- 20GP, 40HC, etc.
  name text    NOT NULL,
  teu  numeric(4,1) NOT NULL
);

-- ── RLS: solo SELECT para autenticados, nada para anon ───────────────────────
ALTER TABLE public.ports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoterms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.container_types  ENABLE ROW LEVEL SECURITY;

CREATE POLICY ports_select           ON public.ports           FOR SELECT TO authenticated USING (true);
CREATE POLICY incoterms_select       ON public.incoterms       FOR SELECT TO authenticated USING (true);
CREATE POLICY container_types_select ON public.container_types FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE/DELETE explícitamente denegados (ninguna política los permite).
-- Recordatorio: RLS activado + sin política = denegado por defecto.

REVOKE INSERT, UPDATE, DELETE ON public.ports           FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.incoterms       FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.container_types FROM authenticated, anon;

-- ── Seed: Puertos ────────────────────────────────────────────────────────────
INSERT INTO public.ports (code, name, country_code, type, is_featured) VALUES
  -- República Dominicana
  ('DOPCM', 'Caucedo (Multimodal)',           'DO', 'sea',  true),
  ('DOHAI', 'Haina',                          'DO', 'sea',  true),
  ('DOSDQ', 'Santo Domingo – Las Américas',   'DO', 'air',  true),
  ('DOPOP', 'Puerto Plata – Luperón',         'DO', 'air',  false),
  -- Estados Unidos
  ('USMIA', 'Miami',                          'US', 'both', true),
  ('USFLL', 'Fort Lauderdale / Port Everglades','US','sea', true),
  ('USHOU', 'Houston',                        'US', 'sea',  true),
  ('USNYC', 'Nueva York',                     'US', 'sea',  true),
  ('USJFK', 'Nueva York – JFK',               'US', 'air',  false),
  ('USSAV', 'Savannah',                       'US', 'sea',  false),
  ('USORF', 'Norfolk',                        'US', 'sea',  false),
  -- China
  ('CNSHA', 'Shanghái',                       'CN', 'sea',  true),
  ('CNNGB', 'Ningbo',                         'CN', 'sea',  true),
  ('CNTAO', 'Qingdao',                        'CN', 'sea',  true),
  ('CNYTN', 'Yantian (Shenzhen)',              'CN', 'sea',  true),
  ('CNNAO', 'Nansha (Guangzhou)',              'CN', 'sea',  false),
  ('CNPVG', 'Shanghái – Pudong',              'CN', 'air',  false),
  -- Panamá
  ('PACOL', 'Colón (Manzanillo / Colon 2000)','PA', 'sea',  true),
  ('PAPTY', 'Ciudad de Panamá – Tocumen',     'PA', 'air',  false),
  -- Europa
  ('NLRTM', 'Rotterdam',                      'NL', 'sea',  false),
  ('BEANR', 'Amberes',                        'BE', 'sea',  false),
  ('DEHAM', 'Hamburgo',                       'DE', 'sea',  false),
  ('ESBCN', 'Barcelona',                      'ES', 'sea',  false),
  ('ESVLC', 'Valencia',                       'ES', 'sea',  false),
  ('ESMAD', 'Madrid – Barajas',               'ES', 'air',  false),
  ('ITGOA', 'Génova',                         'IT', 'sea',  false),
  -- América Latina
  ('BRSSZ', 'Santos (Brasil)',                'BR', 'sea',  false),
  ('COBUN', 'Buenaventura (Colombia)',         'CO', 'sea',  false),
  ('MXLZC', 'Lázaro Cárdenas (México)',       'MX', 'sea',  false),
  -- Turquía / Asia
  ('TRIST', 'Estambul',                       'TR', 'both', false),
  ('KRPUS', 'Busan (Corea del Sur)',           'KR', 'sea',  false)
ON CONFLICT (code) DO NOTHING;

-- ── Seed: Incoterms 2020 ─────────────────────────────────────────────────────
INSERT INTO public.incoterms (code, name, description) VALUES
  ('EXW', 'Ex Works',                            'El vendedor pone la mercancía a disposición en su local.'),
  ('FCA', 'Free Carrier',                        'El vendedor entrega al transportista designado por el comprador.'),
  ('CPT', 'Carriage Paid To',                    'El vendedor contrata el flete hasta el destino pactado.'),
  ('CIP', 'Carriage and Insurance Paid To',      'Como CPT, el vendedor también contrata el seguro.'),
  ('DAP', 'Delivered at Place',                  'El vendedor entrega en el lugar pactado en destino, sin desaduanar.'),
  ('DPU', 'Delivered at Place Unloaded',         'Como DAP, pero descargado. Solo incoterm que exige descarga al vendedor.'),
  ('DDP', 'Delivered Duty Paid',                 'El vendedor asume todos los costos hasta el destino, incluidos aranceles.'),
  ('FAS', 'Free Alongside Ship',                 'El vendedor entrega junto al barco en el puerto de origen.'),
  ('FOB', 'Free on Board',                       'El vendedor entrega a bordo del barco en el puerto de origen.'),
  ('CFR', 'Cost and Freight',                    'El vendedor paga flete hasta puerto de destino; el riesgo pasa con FOB.'),
  ('CIF', 'Cost, Insurance and Freight',         'Como CFR, el vendedor también contrata el seguro mínimo.')
ON CONFLICT (code) DO NOTHING;

-- ── Seed: Tipos de contenedor ────────────────────────────────────────────────
INSERT INTO public.container_types (code, name, teu) VALUES
  ('20GP', 'Seco 20 pies (20GP)',           1.0),
  ('40GP', 'Seco 40 pies (40GP)',           2.0),
  ('40HC', 'High Cube 40 pies (40HC)',      2.0),
  ('20RF', 'Refrigerado 20 pies (20RF)',    1.0),
  ('40RF', 'Refrigerado 40 pies (40RF)',    2.0),
  ('45HC', 'High Cube 45 pies (45HC)',      2.5),
  ('LCL',  'Carga consolidada (LCL)',       0.0)
ON CONFLICT (code) DO NOTHING;



-- ============================================================
-- 0014_charge_types.sql
-- ============================================================

-- 0014_charge_types.sql
-- Tipos de cargo por empresa (cargos de cotizaciones y embarques).
-- stage_definitions: etapas personalizables del proceso (seed en Fase C).

-- ── Tipos de cargo ───────────────────────────────────────────────────────────
CREATE TABLE public.charge_types (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code         text    NOT NULL,
  name         text    NOT NULL,
  default_unit text,                            -- BL, KG, CONT, %, VIAJE, DÍA…
  taxable      boolean NOT NULL DEFAULT false,  -- aplica ITBIS (18%)
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX charge_types_tenant_idx ON public.charge_types (tenant_id, active);

-- ── Etapas del proceso (estructura; seed en Fase C) ──────────────────────────
CREATE TABLE public.stage_definitions (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name       text    NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ── Triggers ─────────────────────────────────────────────────────────────────
CREATE TRIGGER charge_types_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.charge_types
  FOR EACH ROW EXECUTE FUNCTION private.log_change();

CREATE TRIGGER charge_types_touch
  BEFORE UPDATE ON public.charge_types
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER charge_types_lock_tenant
  BEFORE UPDATE ON public.charge_types
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

CREATE TRIGGER stage_definitions_lock_tenant
  BEFORE UPDATE ON public.stage_definitions
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.charge_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_definitions ENABLE ROW LEVEL SECURITY;

-- charge_types: todo el equipo lee; solo owner/admin escribe
CREATE POLICY charge_types_select ON public.charge_types FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY charge_types_insert ON public.charge_types FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY charge_types_update ON public.charge_types FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY charge_types_delete ON public.charge_types FOR DELETE TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

-- stage_definitions: mismo esquema
CREATE POLICY stage_defs_select ON public.stage_definitions FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY stage_defs_insert ON public.stage_definitions FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

CREATE POLICY stage_defs_update ON public.stage_definitions FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY stage_defs_delete ON public.stage_definitions FOR DELETE TO authenticated
  USING (private.has_role(tenant_id, ARRAY['owner','admin']::public.tenant_role[]));

-- ── RPC: sembrar cargos por defecto (idempotente) ────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_default_charge_types(_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Solo siembra si la empresa no tiene cargos todavía
  IF EXISTS (SELECT 1 FROM public.charge_types WHERE tenant_id = _tenant) THEN
    RETURN;
  END IF;

  INSERT INTO public.charge_types (tenant_id, code, name, default_unit, taxable) VALUES
    (_tenant, 'FLT-MAR', 'Flete marítimo',            'BL',    false),
    (_tenant, 'FLT-AIR', 'Flete aéreo',               'KG',    false),
    (_tenant, 'BAF',     'Recargo por combustible',    'BL',    false),
    (_tenant, 'THC-ORI', 'THC origen',                 'CONT',  false),
    (_tenant, 'THC-DST', 'THC destino',                'CONT',  false),
    (_tenant, 'MNJ',     'Manejo / Handling',          'BL',    false),
    (_tenant, 'SEG',     'Seguro de carga',            '%',     false),
    (_tenant, 'DSP',     'Despacho aduanal',           'BL',    true),
    (_tenant, 'TRP-LOC', 'Transporte local',           'VIAJE', true),
    (_tenant, 'ALM',     'Almacenaje',                 'DÍA',   false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_charge_types(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.seed_default_charge_types(uuid) TO authenticated;



-- ============================================================
-- 0015_tenant_settings.sql
-- ============================================================

-- 0015_tenant_settings.sql
-- Amplía la tabla tenants con campos de configuración de la empresa:
-- logo, datos fiscales/contacto, segunda moneda y tasa de cambio.
-- También configura el bucket de Storage para activos de la empresa.

-- ── Nuevas columnas en tenants ───────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN logo_url            text,
  ADD COLUMN tax_id              text,         -- RNC (DO), EIN (US), etc.
  ADD COLUMN address             text,
  ADD COLUMN phone               text,
  ADD COLUMN contact_email       text,
  ADD COLUMN secondary_currency  char(3) NOT NULL DEFAULT 'DOP',
  ADD COLUMN exchange_rate       numeric(10,4)  NOT NULL DEFAULT 1,
  ADD COLUMN updated_at          timestamptz    NOT NULL DEFAULT now();

-- Trigger updated_at en tenants (tabla núcleo no lo tenía)
CREATE OR REPLACE FUNCTION private.touch_tenants_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN new.updated_at := now(); RETURN new; END; $$;

CREATE TRIGGER tenants_touch
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION private.touch_tenants_updated_at();

-- ── tenant_by_slug: añadir logo_url para el layout ───────────────────────────
-- (El proxy usa esta función; añadimos logo_url para mostrarlo en la cabecera)
CREATE OR REPLACE FUNCTION public.tenant_by_slug(_slug text)
RETURNS TABLE (
  id       uuid,
  name     text,
  country  char(2),
  locale   text,
  status   public.tenant_status,
  logo_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.id, t.name, t.country, t.locale, t.status, t.logo_url
  FROM public.tenants t WHERE t.slug = lower(_slug);
$$;

-- ── Bucket de Storage: tenant-assets ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-assets', 'tenant-assets', false)
ON CONFLICT (id) DO NOTHING;

-- Lectura: cualquier miembro del tenant puede ver sus archivos
CREATE POLICY "tenant members can view assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'tenant-assets'
    AND private.is_member(((storage.foldername(name))[1])::uuid)
  );

-- Escritura: solo owner/admin pueden subir
CREATE POLICY "owner admin can upload assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-assets'
    AND private.has_role(
      ((storage.foldername(name))[1])::uuid,
      ARRAY['owner','admin']::public.tenant_role[]
    )
  );

-- Actualizar (upsert de logo)
CREATE POLICY "owner admin can update assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-assets'
    AND private.has_role(
      ((storage.foldername(name))[1])::uuid,
      ARRAY['owner','admin']::public.tenant_role[]
    )
  );

-- Eliminar
CREATE POLICY "owner admin can delete assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-assets'
    AND private.has_role(
      ((storage.foldername(name))[1])::uuid,
      ARRAY['owner','admin']::public.tenant_role[]
    )
  );



-- ============================================================
-- 0016_shipments.sql
-- ============================================================

-- 0016_shipments.sql
-- Fase C: Embarques.
-- Contenido:
--   1. ALTER stage_definitions — columnas faltantes + seed RPC
--   2. CREATE shipments
--   3. CREATE shipment_containers
--   4. CREATE shipment_events (append-only)
--   5. ALTER quotes — agrega status 'converted'
--   6. RLS en las tres tablas nuevas
--   7. RPCs: search_shipments, convert_quote_to_shipment, seed_stage_definitions
--   8. REVOKE/GRANT

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ALTER TABLE stage_definitions
--    La tabla existe desde 0014 con: id, tenant_id, name, sort_order, color,
--    created_at y UNIQUE(tenant_id, name). Aquí se agregan las columnas que
--    necesita la Fase C y se crea el índice de unicidad sobre (tenant_id, key).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.stage_definitions
  ADD COLUMN key              text,
  ADD COLUMN label            text,
  ADD COLUMN mode             text CHECK (mode IN ('ocean','air','both')),
  ADD COLUMN direction        text CHECK (direction IN ('import','export','both')),
  ADD COLUMN visible_to_customer boolean NOT NULL DEFAULT true,
  ADD COLUMN is_terminal         boolean NOT NULL DEFAULT false;

-- key se hace NOT NULL después de que seed_stage_definitions rellena las filas.
-- Para tenants sin filas existentes el ALTER es inmediato.
-- Para tenants con filas (si ya se aplicó un seed manual), la RPC es idempotente.

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CREATE TABLE shipments
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipments (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number                  text        NOT NULL,
  account_id              uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  mode                    text        NOT NULL CHECK (mode IN ('ocean','air')),
  direction               text        NOT NULL CHECK (direction IN ('import','export')),
  stage_key               text        NOT NULL DEFAULT 'draft',
  origin_port_id          text        REFERENCES public.ports(code),
  destination_port_id     text        REFERENCES public.ports(code),
  incoterm                text        REFERENCES public.incoterms(code),
  carrier_account_id      uuid        REFERENCES public.accounts(id),
  vessel_or_flight        text,
  voyage                  text,
  etd                     date,
  eta                     date,
  atd                     date,
  ata                     date,
  booking_number          text,
  bl_number               text,
  cargo_description       text,
  packages                integer     CHECK (packages IS NULL OR packages > 0),
  weight_kg               numeric(12,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  volume_cbm              numeric(12,3) CHECK (volume_cbm IS NULL OR volume_cbm >= 0),
  customer_reference      text,
  shipper_account_id      uuid        REFERENCES public.accounts(id),
  consignee_account_id    uuid        REFERENCES public.accounts(id),
  notify_party_account_id uuid        REFERENCES public.accounts(id),
  quote_id                uuid        REFERENCES public.quotes(id),
  master_id               uuid,       -- FK se agrega en Fase D (master_bills)
  data                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes                   text,
  internal_notes          text,
  created_by              uuid        DEFAULT auth.uid(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE INDEX shipments_tenant_idx   ON public.shipments (tenant_id, created_at DESC);
CREATE INDEX shipments_account_idx  ON public.shipments (tenant_id, account_id);
CREATE INDEX shipments_stage_idx    ON public.shipments (tenant_id, stage_key);
CREATE INDEX shipments_eta_idx      ON public.shipments (tenant_id, eta) WHERE eta IS NOT NULL;
CREATE INDEX shipments_quote_idx    ON public.shipments (quote_id)       WHERE quote_id IS NOT NULL;

CREATE TRIGGER shipments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER shipments_updated
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER shipments_lock_tid
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CREATE TABLE shipment_containers
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipment_containers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id        uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  container_number   text,
  container_type_id  text        REFERENCES public.container_types(code),
  seal_number        text,
  weight_kg          numeric(12,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX containers_shipment_idx ON public.shipment_containers (shipment_id);

CREATE TRIGGER containers_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.shipment_containers
  FOR EACH ROW EXECUTE FUNCTION private.log_change();
CREATE TRIGGER containers_updated
  BEFORE UPDATE ON public.shipment_containers
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER containers_lock_tid
  BEFORE UPDATE ON public.shipment_containers
  FOR EACH ROW EXECUTE FUNCTION private.lock_tenant_id();

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. CREATE TABLE shipment_events (append-only)
--    bigint GENERATED ALWAYS AS IDENTITY — igual que audit_log (registros
--    de alto volumen, secuenciales, no necesitan UUID).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.shipment_events (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id           uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id         uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  kind                text        NOT NULL
                      CHECK (kind IN ('stage_changed','eta_changed','note','document','tracking','system')),
  from_stage          text,
  to_stage            text,
  message             text,
  visible_to_customer boolean     NOT NULL DEFAULT false,
  actor_id            uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_shipment_idx ON public.shipment_events (shipment_id, created_at DESC);
CREATE INDEX events_tenant_idx   ON public.shipment_events (tenant_id,   created_at DESC);

-- Append-only: private.deny_mutation() existe desde migración 0009.
CREATE TRIGGER events_no_update
  BEFORE UPDATE ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();
CREATE TRIGGER events_no_delete
  BEFORE DELETE ON public.shipment_events
  FOR EACH ROW EXECUTE FUNCTION private.deny_mutation();

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. ALTER quotes — agregar status 'converted'
--    Necesario para que convert_quote_to_shipment pueda marcar la cotización.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft','sent','accepted','expired','rejected','converted'));

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shipments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_events     ENABLE ROW LEVEL SECURITY;

-- ── shipments ────────────────────────────────────────────────────────────────
CREATE POLICY shipments_sel ON public.shipments FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY shipments_ins ON public.shipments FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]));

CREATE POLICY shipments_upd ON public.shipments FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY shipments_del ON public.shipments FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── shipment_containers ──────────────────────────────────────────────────────
CREATE POLICY containers_sel ON public.shipment_containers FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY containers_ins ON public.shipment_containers FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]));

CREATE POLICY containers_upd ON public.shipment_containers FOR UPDATE TO authenticated
  USING  (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]))
  WITH CHECK (private.is_member(tenant_id));

CREATE POLICY containers_del ON public.shipment_containers FOR DELETE TO authenticated
  USING (private.has_role(tenant_id,
    ARRAY['owner','admin','manager']::public.tenant_role[]));

-- ── shipment_events (solo lectura + append desde cliente) ───────────────────
CREATE POLICY events_sel ON public.shipment_events FOR SELECT TO authenticated
  USING (private.is_member(tenant_id));

CREATE POLICY events_ins ON public.shipment_events FOR INSERT TO authenticated
  WITH CHECK (private.has_role(tenant_id,
    ARRAY['owner','admin','manager','operator','sales']::public.tenant_role[]));

-- Sin UPDATE/DELETE policies → denegado (el trigger deny_mutation es segunda barrera).

-- ══════════════════════════════════════════════════════════════════════════════
-- 7a. RPC search_shipments
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.search_shipments(
  _tenant    uuid,
  _q         text DEFAULT '',
  _stage     text DEFAULT '',
  _mode      text DEFAULT '',
  _direction text DEFAULT '',
  _limit     int  DEFAULT 50
) RETURNS TABLE (
  id                  uuid,
  number              text,
  account_id          uuid,
  account_name        text,
  mode                text,
  direction           text,
  stage_key           text,
  origin_port_id      text,
  destination_port_id text,
  eta                 date,
  updated_at          timestamptz,
  created_at          timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    s.id,
    s.number,
    s.account_id,
    a.name,
    s.mode,
    s.direction,
    s.stage_key,
    s.origin_port_id,
    s.destination_port_id,
    s.eta,
    s.updated_at,
    s.created_at
  FROM public.shipments s
  LEFT JOIN public.accounts a ON a.id = s.account_id
  WHERE s.tenant_id = _tenant
    AND private.is_member(_tenant)
    AND (_stage     = '' OR s.stage_key  = _stage)
    AND (_mode      = '' OR s.mode       = _mode)
    AND (_direction = '' OR s.direction  = _direction)
    AND (
      _q = ''
      OR s.number         ILIKE '%' || _q || '%'
      OR s.bl_number      ILIKE '%' || _q || '%'
      OR s.booking_number ILIKE '%' || _q || '%'
      OR a.name           ILIKE '%' || _q || '%'
    )
  ORDER BY s.created_at DESC
  LIMIT _limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_shipments(uuid, text, text, text, text, int) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_shipments(uuid, text, text, text, text, int) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7b. RPC convert_quote_to_shipment
--     Convierte una cotización aceptada en un embarque borrador.
--     Retorna el UUID del nuevo embarque.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.convert_quote_to_shipment(
  _tenant   uuid,
  _quote_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_quote     record;
  v_number    text;
  v_ship_id   uuid;
  v_mode      text;
  v_direction text;
BEGIN
  IF NOT private.is_member(_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Fetch quote (must be accepted and belong to tenant)
  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = _quote_id AND tenant_id = _tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  IF v_quote.status != 'accepted' THEN
    RAISE EXCEPTION 'quote_not_acceptable: status=%', v_quote.status;
  END IF;

  -- Derive mode and direction from service_type
  CASE v_quote.service_type
    WHEN 'mar_import'  THEN v_mode := 'ocean'; v_direction := 'import';
    WHEN 'mar_export'  THEN v_mode := 'ocean'; v_direction := 'export';
    WHEN 'aire_import' THEN v_mode := 'air';   v_direction := 'import';
    ELSE                    v_mode := 'ocean'; v_direction := 'import';
  END CASE;

  -- Generate shipment number
  v_number := public.next_number(_tenant, 'shipments', 'EMB-');

  -- Create draft shipment
  INSERT INTO public.shipments (
    tenant_id, number, account_id, mode, direction,
    stage_key, quote_id, notes, created_by
  ) VALUES (
    _tenant, v_number, v_quote.account_id, v_mode, v_direction,
    'draft', _quote_id, v_quote.notes, auth.uid()
  )
  RETURNING id INTO v_ship_id;

  -- Mark quote as converted
  UPDATE public.quotes
  SET status = 'converted', updated_at = now()
  WHERE id = _quote_id;

  -- Log the event
  INSERT INTO public.shipment_events (
    tenant_id, shipment_id, kind, to_stage,
    message, visible_to_customer, actor_id
  ) VALUES (
    _tenant, v_ship_id, 'stage_changed', 'draft',
    'Embarque creado desde cotización ' || v_quote.number,
    false, auth.uid()
  );

  RETURN v_ship_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convert_quote_to_shipment(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.convert_quote_to_shipment(uuid, uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7c. RPC seed_stage_definitions
--     Siembra las 10 etapas estándar para un tenant.
--     Idempotente: no hace nada si el tenant ya tiene etapas.
--     Solo owner/admin pueden llamarla.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_stage_definitions(_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role(_tenant, ARRAY['owner','admin']::public.tenant_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF EXISTS (SELECT 1 FROM public.stage_definitions WHERE tenant_id = _tenant) THEN
    RETURN;
  END IF;

  INSERT INTO public.stage_definitions
    (tenant_id, key, label, name, sort_order, mode, direction, visible_to_customer, is_terminal)
  VALUES
    (_tenant, 'draft',            'Borrador',      'Borrador',      1,  'both', 'both', false, false),
    (_tenant, 'booked',           'Reservado',     'Reservado',     2,  'both', 'both', true,  false),
    (_tenant, 'picked_up',        'Recogido',      'Recogido',      3,  'both', 'both', true,  false),
    (_tenant, 'at_origin',        'En origen',     'En origen',     4,  'both', 'both', true,  false),
    (_tenant, 'in_transit',       'En tránsito',   'En tránsito',   5,  'both', 'both', true,  false),
    (_tenant, 'at_destination',   'En destino',    'En destino',    6,  'both', 'both', true,  false),
    (_tenant, 'out_for_delivery', 'En reparto',    'En reparto',    7,  'both', 'both', true,  false),
    (_tenant, 'delivered',        'Entregado',     'Entregado',     8,  'both', 'both', true,  false),
    (_tenant, 'completed',        'Completado',    'Completado',    9,  'both', 'both', true,  true),
    (_tenant, 'cancelled',        'Cancelado',     'Cancelado',     10, 'both', 'both', false, true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_stage_definitions(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.seed_stage_definitions(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. REVOKE anon en tablas nuevas
-- ══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON TABLE public.shipments           FROM anon;
REVOKE ALL ON TABLE public.shipment_containers FROM anon;
REVOKE ALL ON TABLE public.shipment_events     FROM anon;

-- Crear índice único de key DESPUÉS de que el seed pueda haber corrido.
-- Para bases limpias (sin stage_definitions aún), esto aplica de inmediato.
-- Para bases con filas existentes sin key, el DBA debe correr
-- seed_stage_definitions() antes de aplicar el índice.
CREATE UNIQUE INDEX stage_defs_tenant_key_idx
  ON public.stage_definitions (tenant_id, key)
  WHERE key IS NOT NULL;


