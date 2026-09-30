begin;

-- Follow-up corrections are audited. Only the newest interaction
-- in the current ownership cycle can carry the next actionable plan.
create index if not exists followups_customer_latest_idx
  on public.followups(customer_id, created_at desc, id desc);
alter table public.followups add column if not exists client_request_id uuid;
create unique index if not exists followups_user_request_unique
  on public.followups(user_id, client_request_id) where client_request_id is not null;

create or replace view public.customer_followup_queue
with (security_invoker = true) as
select
  coalesce(latest.id, c.id) as id,
  c.id as customer_id,
  c.owner_id,
  c.company_name,
  c.contact_name,
  c.phone,
  c.email,
  c.country,
  c.ai_level,
  c.ai_score,
  c.status,
  owner_user.name as owner_name,
  owner_user.email as owner_email,
  latest.type,
  latest.content,
  latest.next_follow_date,
  latest.created_at
from public.customers c
join public.users owner_user on owner_user.id = c.owner_id
left join lateral (
  select f.id, f.type, f.content, f.next_follow_date, f.created_at
  from public.followups f
  where f.customer_id = c.id
    and (c.claimed_at is null or f.created_at >= c.claimed_at)
  order by f.created_at desc, f.id desc
  limit 1
) latest on true
where c.deleted_at is null and c.owner_id is not null
  and coalesce(c.followup_status, '') <> 'NO_FOLLOWUP';

revoke all on public.customer_followup_queue from public, anon;
grant select on public.customer_followup_queue to authenticated;

create or replace view public.customer_followup_history
with (security_invoker = true) as
select
  f.id,
  f.customer_id,
  f.user_id,
  c.owner_id,
  c.company_name,
  c.contact_name,
  c.phone,
  c.email,
  c.country,
  c.ai_level,
  c.ai_score,
  c.status,
  actor.name as actor_name,
  actor.email as actor_email,
  f.type,
  f.content,
  f.next_follow_date,
  f.created_at
from public.followups f
join public.customers c on c.id = f.customer_id
left join public.users actor on actor.id = f.user_id
where c.deleted_at is null;

revoke all on public.customer_followup_history from public, anon;
grant select on public.customer_followup_history to authenticated;

-- Called only by triggers below. Recipient and plan come from current
-- ownership, never from the author of a historical interaction.
create or replace function public.refresh_customer_followup_notification(p_customer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.customers; f public.followups;
begin
  select * into c from public.customers where id = p_customer_id;
  if c.id is not null and c.deleted_at is null and c.owner_id is not null
    and coalesce(c.followup_status, '') <> 'NO_FOLLOWUP' then
    select * into f from public.followups
    where customer_id = c.id and (c.claimed_at is null or created_at >= c.claimed_at)
    order by created_at desc, id desc limit 1;
  end if;
  update public.system_notifications n
  set action_status = 'RESOLVED', read_at = coalesce(n.read_at, now())
  where n.entity_type = 'followup' and n.action_status = 'PENDING'
    and n.entity_id in (select id from public.followups where customer_id = p_customer_id)
    and (f.id is null or f.next_follow_date is null
      or n.entity_id <> f.id or n.recipient_id <> c.owner_id);
  if f.id is null or f.next_follow_date is null then return; end if;
  insert into public.system_notifications(
    recipient_id,type,category,title,content,href,entity_type,entity_id,
    dedupe_key,deliver_at,action_status,read_at,archived_at)
  values(c.owner_id,'FOLLOWUP_DUE','FOLLOWUP','客户跟进提醒',
    format('客户“%s”已到计划跟进时间，请及时处理。',coalesce(c.company_name,'未命名客户')),
    '/customers/'||c.id,'followup',f.id,'followup-due:'||f.id,
    f.next_follow_date,'PENDING',null,null)
  on conflict(recipient_id,dedupe_key) where dedupe_key is not null do update set
    content=excluded.content,href=excluded.href,deliver_at=excluded.deliver_at,
    action_status='PENDING',read_at=null,archived_at=null;
end $$;
revoke all on function public.refresh_customer_followup_notification(uuid) from public, anon, authenticated;

create or replace function public.schedule_followup_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare latest_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.system_notifications where entity_type='followup' and entity_id=old.id;
    perform public.refresh_customer_followup_notification(old.customer_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and new.next_follow_date is not distinct from old.next_follow_date then return new; end if;
  select f.id into latest_id from public.followups f
  join public.customers c on c.id=f.customer_id
  where c.id=new.customer_id and (c.claimed_at is null or f.created_at >= c.claimed_at)
  order by f.created_at desc,f.id desc limit 1;
  if latest_id is distinct from new.id then
    update public.system_notifications set action_status='RESOLVED',read_at=coalesce(read_at,now())
    where entity_type='followup' and entity_id=new.id and action_status='PENDING';
    return new;
  end if;
  perform public.refresh_customer_followup_notification(new.customer_id);
  return new;
end $$;

create or replace function public.sync_followup_notification_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id
    or new.claimed_at is distinct from old.claimed_at
    or new.deleted_at is distinct from old.deleted_at
    or new.followup_status is distinct from old.followup_status then
    perform public.refresh_customer_followup_notification(new.id);
  end if;
  return new;
end $$;
drop trigger if exists customers_sync_followup_notification on public.customers;
create trigger customers_sync_followup_notification
after update of owner_id,claimed_at,deleted_at,followup_status on public.customers
for each row execute function public.sync_followup_notification_ownership();

create or replace function public.create_customer_followup(
  p_customer_id uuid, p_type text, p_content text, p_next_follow_date timestamptz,
  p_outcome text default 'CONTACT_ONLY', p_followup_status text default null,
  p_client_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.users; c public.customers; f public.followups;
  next_status text := nullif(upper(trim(coalesce(p_followup_status,''))), '');
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('followups.view')
    or not public.current_user_has_business_permission('followups.create') then raise exception '无权新增跟进'; end if;
  select * into c from public.customers where id=p_customer_id and deleted_at is null for update;
  if c.id is null then raise exception '客户不存在或已删除'; end if;
  if c.owner_id is null then raise exception '公海客户需先完成认领，才可以新增跟进'; end if;
  if actor.role <> 'ADMIN' and c.owner_id <> actor.id then raise exception '只能新增归属自己的客户跟进'; end if;
  if p_type is null or p_type not in ('EMAIL','WHATSAPP','PHONE','LINKEDIN','OTHER') then raise exception '无效跟进类型'; end if;
  if nullif(trim(coalesce(p_content,'')),'') is null then raise exception '请填写跟进内容'; end if;
  if p_outcome is null or p_outcome not in ('CONTACT_ONLY','INTEREST','NO_INTEREST') then raise exception '请选择有效的客户反馈结果'; end if;
  if next_status is not null then
    if not public.current_user_has_business_permission('customers.view')
      or not public.current_user_has_business_permission('customers.edit') then raise exception '无权修改客户跟进状态'; end if;
    if next_status not in ('WAITING_CONTACT','FOLLOWUP_REQUIRED','WAITING_REPLY','PAUSED','NO_FOLLOWUP') then raise exception '请选择有效的跟进状态'; end if;
  end if;
  if p_client_request_id is not null then
    select * into f from public.followups where user_id=actor.id and client_request_id=p_client_request_id;
    if f.id is not null then
      if f.customer_id <> c.id or f.type <> p_type or f.content <> trim(p_content)
        or f.next_follow_date is distinct from p_next_follow_date or f.outcome <> p_outcome
        or not exists (select 1 from public.audit_logs a where a.target_id=c.id
          and a.action='FOLLOWUP_CREATE' and a.content->>'followup_id'=f.id::text
          and (a.content->>'requested_followup_status') is not distinct from next_status) then
        raise exception '本次提交编号已用于其他跟进内容，请刷新确认已保存的记录';
      end if;
      return to_jsonb(f) || jsonb_build_object('creator',jsonb_build_object('name',actor.name,'email',actor.email));
    end if;
  end if;
  insert into public.followups(customer_id,user_id,type,content,next_follow_date,outcome,client_request_id,created_at)
  values(c.id,actor.id,p_type,trim(p_content),p_next_follow_date,p_outcome,p_client_request_id,clock_timestamp()) returning * into f;
  update public.customers set last_contact_time=f.created_at,
    followup_status=coalesce(next_status,followup_status),updated_at=now() where id=c.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'FOLLOWUP_CREATE','customer',c.id,jsonb_build_object(
    'followup_id',f.id,'type',f.type,'outcome',f.outcome,'next_follow_date',f.next_follow_date,
    'requested_followup_status',next_status));
  if next_status is not null and next_status is distinct from c.followup_status then
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'CUSTOMER_FOLLOWUP_STATUS','customer',c.id,jsonb_build_object(
      'customer_name',c.company_name,'from_status',c.followup_status,'to_status',next_status));
  end if;
  return to_jsonb(f) || jsonb_build_object('creator',jsonb_build_object('name',actor.name,'email',actor.email));
end $$;
revoke all on function public.create_customer_followup(uuid,text,text,timestamptz,text,text,uuid) from public,anon;
grant execute on function public.create_customer_followup(uuid,text,text,timestamptz,text,text,uuid) to authenticated;

create or replace function public.correct_customer_followup(
  p_followup_id uuid,p_type text,p_content text,p_next_follow_date timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.users; c public.customers; f public.followups; updated public.followups; customer_id_value uuid;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('followups.view')
    or not public.current_user_has_business_permission('followups.edit') then raise exception '无权更正跟进'; end if;
  select customer_id into customer_id_value from public.followups where id=p_followup_id;
  select * into c from public.customers where id=customer_id_value and deleted_at is null for update;
  if c.id is null then raise exception '客户不存在或已删除'; end if;
  select * into f from public.followups where id=p_followup_id and customer_id=c.id for update;
  if f.id is null then raise exception '跟进记录不存在'; end if;
  if actor.role <> 'ADMIN' and (f.user_id <> actor.id or c.owner_id is distinct from actor.id) then
    raise exception '仅当前归属销售员可更正本人创建的跟进记录'; end if;
  if p_type is null or p_type not in ('EMAIL','WHATSAPP','PHONE','LINKEDIN','OTHER') then raise exception '无效跟进类型'; end if;
  if nullif(trim(coalesce(p_content,'')),'') is null then raise exception '请填写跟进内容'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception '请填写至少 5 个字的更正原因'; end if;
  update public.followups set type=p_type,content=trim(p_content),next_follow_date=p_next_follow_date
  where id=f.id returning * into updated;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'FOLLOWUP_UPDATE','customer',c.id,jsonb_build_object(
    'followup_id',f.id,'reason',trim(p_reason),
    'before',jsonb_build_object('type',f.type,'content',f.content,'next_follow_date',f.next_follow_date),
    'after',jsonb_build_object('type',updated.type,'content',updated.content,'next_follow_date',updated.next_follow_date)));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.correct_customer_followup(uuid,text,text,timestamptz,text) from public,anon;
grant execute on function public.correct_customer_followup(uuid,text,text,timestamptz,text) to authenticated;

commit;
