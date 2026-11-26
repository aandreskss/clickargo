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
