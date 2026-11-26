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
