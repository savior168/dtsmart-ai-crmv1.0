begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.system_announcements
  add column if not exists announcement_type text not null default 'GENERAL',
  add column if not exists priority text not null default 'STANDARD';

alter table public.system_announcements
  drop constraint if exists system_announcements_type_check,
  add constraint system_announcements_type_check
    check (announcement_type in ('GENERAL','MAINTENANCE','INCIDENT','UPGRADE','OPTIMIZATION','SECURITY','POLICY')),
  drop constraint if exists system_announcements_priority_check,
  add constraint system_announcements_priority_check
    check (priority in ('STANDARD','IMPORTANT','URGENT'));

-- Keep the legacy three-argument RPC unavailable. The four-argument RPC remains as
-- a safe compatibility wrapper for already-open tabs and older app deployments.
revoke all on function public.publish_system_announcement(uuid,text,text)
  from public, anon, authenticated;

create or replace function public.publish_system_announcement(
  p_request_id uuid,
  p_title text,
  p_content text,
  p_recipient_roles text[],
  p_announcement_type text,
  p_priority text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor public.users%rowtype;
  announcement_id uuid;
  existing public.system_announcements%rowtype;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_content text := btrim(coalesce(p_content, ''));
  normalized_roles text[];
  delivered_count integer;
begin
  select * into actor from public.users where id = auth.uid();
  if actor.id is null or actor.role <> 'ADMIN' or actor.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN';
  end if;
  if p_request_id is null or char_length(clean_title) not between 1 and 120
    or char_length(clean_content) not between 1 and 4000
    or p_announcement_type is null
    or p_announcement_type not in ('GENERAL','MAINTENANCE','INCIDENT','UPGRADE','OPTIMIZATION','SECURITY','POLICY')
    or p_priority is null or p_priority not in ('STANDARD','IMPORTANT','URGENT') then
    raise exception 'INVALID_ANNOUNCEMENT';
  end if;
  if p_recipient_roles is not null then
    if cardinality(p_recipient_roles) = 0 or cardinality(p_recipient_roles) > 5
      or array_position(p_recipient_roles, null) is not null
      or exists (select 1 from unnest(p_recipient_roles) role_code
        where role_code not in ('ADMIN', 'SUPERVISOR', 'SALES', 'ORDER_CLERK', 'WAREHOUSE')) then
      raise exception 'INVALID_RECIPIENT_ROLES';
    end if;
    select array_agg(distinct role_code order by role_code) into normalized_roles
    from unnest(p_recipient_roles) role_code;
    if cardinality(normalized_roles) <> cardinality(p_recipient_roles) then
      raise exception 'INVALID_RECIPIENT_ROLES';
    end if;
  end if;

  insert into public.system_announcements(
    request_id,title,content,published_by,recipient_roles,announcement_type,priority
  ) values (
    p_request_id,clean_title,clean_content,actor.id,normalized_roles,p_announcement_type,p_priority
  )
  on conflict (request_id) do nothing
  returning id into announcement_id;
  if announcement_id is null then
    select * into existing from public.system_announcements where request_id = p_request_id;
    if existing.title <> clean_title or existing.content <> clean_content
      or existing.recipient_roles is distinct from normalized_roles
      or existing.announcement_type <> p_announcement_type or existing.priority <> p_priority then
      raise exception 'ANNOUNCEMENT_REQUEST_CONFLICT';
    end if;
    return existing.id;
  end if;

  insert into public.system_notifications(
    recipient_id,type,category,title,content,metadata,href,entity_type,entity_id,dedupe_key,action_status
  )
  select u.id,'SYSTEM_ANNOUNCEMENT','SYSTEM',clean_title,clean_content,
    jsonb_build_object('announcement_type',p_announcement_type,'priority',p_priority),
    '/notifications','system_announcement',announcement_id,'system-announcement:' || announcement_id,'INFO'
  from public.users u
  where u.status = 'ACTIVE' and (normalized_roles is null or u.role = any(normalized_roles));
  get diagnostics delivered_count = row_count;
  if delivered_count = 0 then
    raise exception 'NO_ACTIVE_RECIPIENTS';
  end if;
  update public.system_announcements set recipient_count = delivered_count where id = announcement_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values (actor.id,'SYSTEM_ANNOUNCEMENT_PUBLISH','system_announcement',announcement_id,
    jsonb_build_object('title',clean_title,'announcement_type',p_announcement_type,
      'priority',p_priority,'recipient_roles',normalized_roles,'recipient_count',delivered_count));
  return announcement_id;
end $$;

create or replace function public.publish_system_announcement(
  p_request_id uuid, p_title text, p_content text, p_recipient_roles text[]
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.publish_system_announcement(
    p_request_id,p_title,p_content,p_recipient_roles,'GENERAL','STANDARD'
  );
end $$;

revoke all on function public.publish_system_announcement(uuid,text,text,text[])
  from public, anon, authenticated;
grant execute on function public.publish_system_announcement(uuid,text,text,text[])
  to authenticated;

revoke all on function public.publish_system_announcement(uuid,text,text,text[],text,text)
  from public, anon, authenticated;
grant execute on function public.publish_system_announcement(uuid,text,text,text[],text,text)
  to authenticated;

commit;
