begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Closing a toast is not reading or archiving its underlying notification.
alter table public.system_notifications
  add column if not exists dismissed_at timestamptz;

create table if not exists public.notification_delivery_policies (
  type text primary key,
  popup_enabled boolean not null default true,
  voice_enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.notification_delivery_policies enable row level security;
drop policy if exists notification_delivery_policies_read on public.notification_delivery_policies;
create policy notification_delivery_policies_read on public.notification_delivery_policies
  for select to authenticated using (true);
grant select on public.notification_delivery_policies to authenticated;

insert into public.notification_delivery_policies (type, popup_enabled, voice_enabled) values
  ('STOCK_ORDER_CREATED', true, true),
  ('STOCK_STATUS_CHANGED', true, true),
  ('STOCK_PROGRESS_ROUTINE', false, false),
  ('PI_CHANGE_REQUESTED', true, true),
  ('PI_CHANGE_APPLIED', true, true),
  ('PI_CHANGE_REJECTED', true, true),
  ('REGISTRATION_REVIEW', true, true),
  ('PROTECTION_RENEWAL_REVIEW', true, true),
  ('CUSTOMER_ADMIN_ASSIGNED', true, true),
  ('CUSTOMER_HANDOVER', true, true),
  ('FOLLOWUP_DUE', false, false),
  ('SYSTEM_ANNOUNCEMENT', true, false)
on conflict (type) do nothing;

create or replace function public.set_notification_delivery_policy(
  p_type text, p_popup_enabled boolean, p_voice_enabled boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor public.users%rowtype;
begin
  select * into actor from public.users where id = auth.uid();
  if actor.id is null or actor.role <> 'ADMIN' or actor.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN';
  end if;
  if p_type is null or p_popup_enabled is null or p_voice_enabled is null
    or not exists (select 1 from public.notification_delivery_policies where type = p_type) then
    raise exception 'INVALID_NOTIFICATION_POLICY';
  end if;
  update public.notification_delivery_policies
    set popup_enabled = p_popup_enabled, voice_enabled = p_voice_enabled,
      updated_by = actor.id, updated_at = now()
    where type = p_type;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values (actor.id,'NOTIFICATION_POLICY_UPDATE','notification_policy',null,
    jsonb_build_object('type',p_type,'popup_enabled',p_popup_enabled,'voice_enabled',p_voice_enabled));
end $$;
revoke all on function public.set_notification_delivery_policy(text,boolean,boolean) from public;
grant execute on function public.set_notification_delivery_policy(text,boolean,boolean) to authenticated;

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_notification_preferences enable row level security;
drop policy if exists user_notification_preferences_self on public.user_notification_preferences;
create policy user_notification_preferences_self on public.user_notification_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_notification_preferences to authenticated;

create table if not exists public.system_announcements (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  title text not null check (char_length(title) between 1 and 120),
  content text not null check (char_length(content) between 1 and 4000),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now()
);
alter table public.system_announcements enable row level security;

create or replace function public.publish_system_announcement(
  p_request_id uuid, p_title text, p_content text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor public.users%rowtype;
  announcement_id uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_content text := btrim(coalesce(p_content, ''));
begin
  select * into actor from public.users where id = auth.uid();
  if actor.id is null or actor.role <> 'ADMIN' or actor.status <> 'ACTIVE' then
    raise exception 'FORBIDDEN';
  end if;
  if p_request_id is null or char_length(clean_title) not between 1 and 120
    or char_length(clean_content) not between 1 and 4000 then
    raise exception 'INVALID_ANNOUNCEMENT';
  end if;

  insert into public.system_announcements(request_id,title,content,published_by)
  values (p_request_id,clean_title,clean_content,actor.id)
  on conflict (request_id) do nothing
  returning id into announcement_id;
  if announcement_id is null then
    select id into announcement_id from public.system_announcements where request_id = p_request_id;
    return announcement_id;
  end if;

  insert into public.system_notifications(
    recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status
  )
  select u.id,'SYSTEM_ANNOUNCEMENT','SYSTEM',clean_title,clean_content,
    '/notifications','system_announcement',announcement_id,'system-announcement:' || announcement_id,'INFO'
  from public.users u where u.status = 'ACTIVE';

  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values (actor.id,'SYSTEM_ANNOUNCEMENT_PUBLISH','system_announcement',announcement_id,
    jsonb_build_object('title',clean_title,'recipient_count',(select count(*) from public.users where status = 'ACTIVE')));
  return announcement_id;
end $$;
revoke all on function public.publish_system_announcement(uuid,text,text) from public;
grant execute on function public.publish_system_announcement(uuid,text,text) to authenticated;

commit;
