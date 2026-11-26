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
