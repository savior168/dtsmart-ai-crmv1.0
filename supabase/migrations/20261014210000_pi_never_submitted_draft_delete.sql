-- Only a never-submitted direct PI draft may be physically deleted.
-- An order that ever reached the warehouse keeps its history after recall.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('SALES','orders.delete_draft',true),
       ('SUPERVISOR','orders.delete_draft',false),
       ('WAREHOUSE','orders.delete_draft',false),
       ('ADMIN','orders.delete_draft',true)
on conflict(role_code,permission_code) do nothing;

create function public.delete_never_submitted_pi_draft(p_order_id uuid,p_expected_revision integer)
returns void language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  target public.sales_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('SALES','ADMIN')
    or not public.current_user_has_business_permission('orders.delete_draft') then
    raise exception '没有删除PI草稿权限';
  end if;
  select * into target from public.sales_orders where id=p_order_id for update;
  if target.id is null then raise exception 'PI草稿不存在或已删除'; end if;
  if actor.role<>'ADMIN' and target.sales_user_id<>actor.id then
    raise exception '只能删除归属自己的PI草稿';
  end if;
  if target.pi_revision is distinct from p_expected_revision then
    raise exception 'PI草稿已被修改，请刷新后重试';
  end if;
  if target.confirmation_method<>'DIRECT_PI' or target.status<>'DRAFT'
    or target.confirmed_at is not null
    or exists(select 1 from public.stock_orders s where s.sales_order_id=target.id or s.quote_id=target.quote_id)
    or exists(select 1 from public.audit_logs a where a.target_type='sales_order' and a.target_id=target.id
      and a.action in ('PI_SUBMIT','PI_RECALL')) then
    raise exception '只有从未提交仓库的PI草稿可以删除；已提交记录请取消并保留历史';
  end if;
  if exists(select 1 from public.attachments a where a.quote_id=target.quote_id)
    or exists(select 1 from public.quotes q where q.supersedes_quote_id=target.quote_id) then
    raise exception 'PI草稿存在关联资料，不能直接删除';
  end if;
  delete from public.sales_order_items where sales_order_id=target.id;
  delete from public.sales_orders where id=target.id;
  delete from public.quote_items where quote_id=target.quote_id;
  delete from public.quotes where id=target.quote_id and pi_direct=true;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_DRAFT_DELETE','sales_order',target.id,
    jsonb_build_object('order_number',target.order_number,'quote_id',target.quote_id,
      'customer_id',target.customer_id,'owner_id',target.sales_user_id,
      'revision',target.pi_revision));
end $$;

revoke all on function public.delete_never_submitted_pi_draft(uuid,integer) from public,anon;
grant execute on function public.delete_never_submitted_pi_draft(uuid,integer) to authenticated;
commit;
