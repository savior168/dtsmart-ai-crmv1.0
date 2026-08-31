alter table public.customer_claims
  add column if not exists owner_name text,
  add column if not exists claimed_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists release_reason text;

create index if not exists customer_claims_user_id_idx on public.customer_claims(user_id);
create index if not exists customer_protection_active_idx
  on public.customer_protection(customer_id, status, expire_date);
create index if not exists followups_next_follow_idx on public.followups(user_id, next_follow_date);

create or replace function public.claim_customer(p_customer_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null then raise exception '当前用户无效'; end if;

  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.owner_id is not null or target.status not in ('UNCLAIMED', 'RELEASED') then
    raise exception '客户已被认领';
  end if;
  if actor.role = 'MANAGER' and target.department_id is distinct from actor.department_id then
    raise exception '无权认领其他部门客户';
  end if;
  if exists (
    select 1 from public.customer_protection p
    where p.customer_id = target.id and p.status = 'ACTIVE'
      and (p.expire_date is null or p.expire_date > now()) and p.owner_id <> actor.id
  ) and actor.role <> 'ADMIN' then
    raise exception '客户仍在保护期';
  end if;

  update public.customers set owner_id = actor.id, department_id = actor.department_id, status = 'CLAIMED'
  where id = target.id returning * into target;
  insert into public.customer_claims(customer_id, user_id, action, claim_type, owner_name, claimed_at)
  values(target.id, actor.id, 'CLAIM', 'SELF_CLAIM', actor.name, now());
  return target;
end;
$$;

create or replace function public.release_customer(p_customer_id uuid, p_reason text)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
  original_owner public.users;
  last_claim timestamptz;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is null then raise exception '客户当前没有归属人'; end if;
  if target.owner_id <> actor.id and actor.role <> 'ADMIN' then raise exception '只能释放自己的客户'; end if;
  if nullif(trim(p_reason), '') is null then raise exception '请填写释放原因'; end if;

  select * into original_owner from public.users where id = target.owner_id;
  select created_at into last_claim from public.customer_claims
    where customer_id = target.id and action in ('CLAIM', 'TRANSFER')
    order by created_at desc limit 1;
  update public.customer_protection set status = 'RELEASED'
    where customer_id = target.id and status = 'ACTIVE';
  update public.customers set owner_id = null, status = 'RELEASED'
    where id = target.id returning * into target;
  insert into public.customer_claims(customer_id, user_id, action, claim_type, owner_name, claimed_at, released_at, release_reason)
  values(target.id, original_owner.id, 'RELEASE', 'SELF_CLAIM', original_owner.name, last_claim, now(), trim(p_reason));
  return target;
end;
$$;

create or replace function public.assign_customer(p_customer_id uuid, p_user_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
  assignee public.users;
  operation text;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.role <> 'ADMIN' then raise exception '仅管理员可分配客户'; end if;
  select * into assignee from public.users where id = p_user_id and status = 'ACTIVE';
  if assignee.id is null then raise exception '目标用户不存在'; end if;
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  operation := case when target.owner_id is null then 'CLAIM' else 'TRANSFER' end;
  update public.customers set owner_id = assignee.id, department_id = assignee.department_id, status = 'CLAIMED'
    where id = target.id returning * into target;
  insert into public.customer_claims(customer_id, user_id, action, claim_type, owner_name, claimed_at)
  values(target.id, assignee.id, operation, 'ADMIN_ASSIGN', assignee.name, now());
  return target;
end;
$$;

create or replace function public.set_customer_stage(p_customer_id uuid, p_status text)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
  protection_type text;
  protection_expire timestamptz;
begin
  if p_status not in ('CLAIMED', 'FOLLOWING', 'QUOTE', 'DEAL') then raise exception '无效客户阶段'; end if;
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id <> actor.id and actor.role <> 'ADMIN' then raise exception '无权修改客户阶段'; end if;
  if target.owner_id is null then raise exception '请先认领或分配客户'; end if;

  update public.customer_protection set status = 'SUPERSEDED'
    where customer_id = target.id and status = 'ACTIVE';
  if p_status in ('FOLLOWING', 'QUOTE', 'DEAL') then
    protection_type := case p_status when 'FOLLOWING' then 'INTENT' when 'QUOTE' then 'QUOTE' else 'DEAL' end;
    protection_expire := case p_status when 'FOLLOWING' then now() + interval '90 days' when 'QUOTE' then now() + interval '180 days' else null end;
    insert into public.customer_protection(customer_id, owner_id, type, start_date, expire_date, status)
    values(target.id, target.owner_id, protection_type, now(), protection_expire, 'ACTIVE');
  end if;
  update public.customers set status = p_status where id = target.id returning * into target;
  return target;
end;
$$;

revoke execute on function public.claim_customer(uuid) from public, anon;
revoke execute on function public.release_customer(uuid, text) from public, anon;
revoke execute on function public.assign_customer(uuid, uuid) from public, anon;
revoke execute on function public.set_customer_stage(uuid, text) from public, anon;
grant execute on function public.claim_customer(uuid) to authenticated;
grant execute on function public.release_customer(uuid, text) to authenticated;
grant execute on function public.assign_customer(uuid, uuid) to authenticated;
grant execute on function public.set_customer_stage(uuid, text) to authenticated;
