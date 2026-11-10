begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Existing announcements remain ordinary notices. Only newly published notices
-- with an explicit level may interrupt a user or require acknowledgement.
alter table public.system_announcements
  add column if not exists delivery_level text not null default 'NORMAL'
    check (delivery_level in ('NORMAL', 'IMPORTANT', 'CRITICAL'));
alter table public.system_notifications
  add column if not exists acknowledged_at timestamptz;

create index if not exists system_notifications_announcement_ack_idx
  on public.system_notifications(recipient_id, deliver_at)
  where type = 'SYSTEM_ANNOUNCEMENT' and action_status = 'PENDING' and acknowledged_at is null;

create or replace function public.publish_system_announcement(
  p_request_id uuid, p_title text, p_content text, p_recipient_roles text[], p_delivery_level text
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
    or p_delivery_level is null or p_delivery_level not in ('NORMAL', 'IMPORTANT', 'CRITICAL') then
    raise exception 'INVALID_ANNOUNCEMENT';
  end if;
  if p_recipient_roles is not null then
    if cardinality(p_recipient_roles) = 0 or cardinality(p_recipient_roles) > 6
      or array_position(p_recipient_roles, null) is not null
      or exists (select 1 from unnest(p_recipient_roles) role_code where role_code not in
        ('ADMIN', 'SUPERVISOR', 'SALES', 'ORDER_CLERK', 'WAREHOUSE', 'FINANCE')) then
      raise exception 'INVALID_RECIPIENT_ROLES';
    end if;
    select array_agg(distinct role_code order by role_code) into normalized_roles
      from unnest(p_recipient_roles) role_code;
    if cardinality(normalized_roles) <> cardinality(p_recipient_roles) then
      raise exception 'INVALID_RECIPIENT_ROLES';
    end if;
  end if;

  insert into public.system_announcements(request_id,title,content,published_by,recipient_roles,delivery_level)
  values (p_request_id,clean_title,clean_content,actor.id,normalized_roles,p_delivery_level)
  on conflict (request_id) do nothing returning id into announcement_id;
  if announcement_id is null then
    select * into existing from public.system_announcements where request_id = p_request_id;
    if existing.title <> clean_title or existing.content <> clean_content
      or existing.recipient_roles is distinct from normalized_roles
      or existing.delivery_level <> p_delivery_level then
      raise exception 'ANNOUNCEMENT_REQUEST_CONFLICT';
    end if;
    return existing.id;
  end if;

  insert into public.system_notifications(
    recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status,metadata
  )
  select u.id,'SYSTEM_ANNOUNCEMENT','SYSTEM',clean_title,clean_content,
    '/notifications','system_announcement',announcement_id,'system-announcement:' || announcement_id,
    case when p_delivery_level = 'CRITICAL' then 'PENDING' else 'INFO' end,
    jsonb_build_object('delivery_level',p_delivery_level)
  from public.users u
  where u.status = 'ACTIVE' and (normalized_roles is null or u.role = any(normalized_roles));
  get diagnostics delivered_count = row_count;
  if delivered_count = 0 then raise exception 'NO_ACTIVE_RECIPIENTS'; end if;
  update public.system_announcements set recipient_count = delivered_count where id = announcement_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values (actor.id,'SYSTEM_ANNOUNCEMENT_PUBLISH','system_announcement',announcement_id,
    jsonb_build_object('title',clean_title,'delivery_level',p_delivery_level,
      'recipient_roles',normalized_roles,'recipient_count',delivered_count));
  return announcement_id;
end $$;

revoke all on function public.publish_system_announcement(uuid,text,text,text[],text)
  from public, anon, authenticated;
grant execute on function public.publish_system_announcement(uuid,text,text,text[],text)
  to authenticated;

-- A mandatory notice cannot be silently read, dismissed, archived or resolved.
-- ACKNOWLEDGE records the recipient's explicit confirmation separately.
create or replace function public.guard_mandatory_announcement_ack()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.type = 'SYSTEM_ANNOUNCEMENT'
    and old.metadata->>'delivery_level' = 'CRITICAL'
    and old.acknowledged_at is null then
    if new.type is distinct from old.type or new.recipient_id is distinct from old.recipient_id
      or new.metadata is distinct from old.metadata or new.content is distinct from old.content
      or new.title is distinct from old.title then
      raise exception 'ANNOUNCEMENT_ACK_REQUIRED';
    end if;
    if new.acknowledged_at is null and
      (new.read_at is distinct from old.read_at
       or new.dismissed_at is distinct from old.dismissed_at
       or new.archived_at is distinct from old.archived_at
       or new.action_status is distinct from old.action_status) then
      raise exception 'ANNOUNCEMENT_ACK_REQUIRED';
    end if;
    if new.acknowledged_at is not null and new.recipient_id is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_mandatory_announcement_ack on public.system_notifications;
create trigger guard_mandatory_announcement_ack before update on public.system_notifications
  for each row execute function public.guard_mandatory_announcement_ack();

commit;
