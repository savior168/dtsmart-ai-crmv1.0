begin;

-- The API already grants administrators cross-owner maintenance authority.
-- Keep the database ownership transition aligned so the RPC cannot silently
-- deny an administrator after the UI exposes the permitted operation.
create or replace function public.release_customer(p_customer_id uuid,p_reason text)
returns public.customers language plpgsql security definer set search_path=public as $$
declare target public.customers; actor public.users; previous_owner uuid; last_claim timestamptz;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is distinct from actor.id and actor.role <> 'ADMIN' then raise exception '只能释放归属自己的客户'; end if;
  if target.status='DEAL' then raise exception '已成交客户为永久保护，不能直接释放'; end if;
  if exists(select 1 from public.quotes q where q.customer_id=target.id and q.status in ('SENT','CONFIRMED'))
    or exists(select 1 from public.sales_orders o where o.customer_id=target.id and o.status not in ('CANCELLED'))
  then raise exception '客户存在进行中的报价或订单，请先完成或取消业务单据后再释放'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception '请填写释放原因'; end if;

  previous_owner:=target.owner_id;
  select created_at into last_claim from public.customer_claims where customer_id=target.id and action in ('CLAIM','TRANSFER') order by created_at desc limit 1;
  update public.customer_protection set status='RELEASED' where customer_id=target.id and owner_id=previous_owner and status='ACTIVE';
  update public.customers set owner_id=null,owner_user_id=null,status='UNCLAIMED',acquisition_scope='PUBLIC_POOL',pool_status='AVAILABLE',assigned_via=null,claimed_at=null,ownership_cycle_id=null,updated_at=now() where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason,source_owner_id)
    values(target.id,actor.id,'RELEASE',case when actor.role='ADMIN' then 'ADMIN_ASSIGN' else 'SELF_CLAIM' end,actor.name,last_claim,now(),trim(p_reason),previous_owner);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'CUSTOMER_RELEASE','customer',target.id,jsonb_build_object('reason',trim(p_reason),'destination','PUBLIC_POOL','previous_owner_id',previous_owner,'admin_override',actor.role='ADMIN'));
  return target;
end $$;

revoke execute on function public.release_customer(uuid,text) from public,anon;
grant execute on function public.release_customer(uuid,text) to authenticated;

commit;
