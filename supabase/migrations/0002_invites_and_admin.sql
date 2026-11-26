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
