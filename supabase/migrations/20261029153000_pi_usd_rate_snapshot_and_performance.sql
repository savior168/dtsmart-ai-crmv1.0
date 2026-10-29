alter table public.pi_exchange_rate_snapshots
  drop constraint if exists pi_exchange_rate_snapshots_source_check;

alter table public.pi_exchange_rate_snapshots
  add constraint pi_exchange_rate_snapshots_source_check
  check (source = any (array['CFETS'::text, 'AGGREGATED'::text, 'BAIDU_FINSCOPE'::text]));

alter table public.sales_orders
  add column if not exists usd_cny_rate_snapshot numeric,
  add column if not exists usd_rate_source_snapshot text,
  add column if not exists usd_rate_reference_date_snapshot date,
  add column if not exists usd_rate_synced_at_snapshot timestamptz;

alter table public.sales_orders
  add constraint sales_orders_usd_cny_rate_snapshot_positive
    check (usd_cny_rate_snapshot is null or usd_cny_rate_snapshot > 0),
  add constraint sales_orders_usd_rate_source_snapshot_check
    check (usd_rate_source_snapshot is null or usd_rate_source_snapshot in ('BAIDU_FINSCOPE', 'CFETS', 'AGGREGATED'));

create or replace function public.submit_direct_pi_order(p_order_id uuid, p_expected_revision integer)
 returns public.sales_orders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  actor public.users;
  target public.sales_orders;
  target_quote public.quotes;
  stock public.stock_orders;
  result public.sales_orders;
  stock_no text;
  usd_reference public.pi_exchange_rate_snapshots;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或PI订单不存在'; end if;
  if target.confirmation_method<>'DIRECT_PI' or target.status<>'DRAFT' or target.prepared_by is distinct from actor.id then
    raise exception '只有归属销售员可以提交PI草稿';
  end if;
  if target.pi_revision is distinct from p_expected_revision then raise exception 'PI草稿已更新，请刷新核对后提交'; end if;
  if stock.id is not null and stock.status<>'DRAFT' then raise exception '备货单状态已改变，请刷新'; end if;
  if exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.create' and o.effect='DENY')
    or (not exists (select 1 from public.role_permission_settings p where p.role_code=actor.role and p.permission_code='orders.create' and p.enabled)
      and not exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.create' and o.effect='ALLOW')) then
    raise exception '当前账号未获PI提交权限';
  end if;
  select * into target_quote from public.quotes where id=target.quote_id for update;
  if target_quote.status<>'DRAFT' or not exists(select 1 from public.sales_order_items where sales_order_id=target.id)
    or target.payment_account_snapshot is null then raise exception 'PI草稿内容不完整'; end if;
  if not exists (select 1 from public.customers c where c.id=target.customer_id and c.deleted_at is null
    and c.owner_id=target.sales_user_id) then
    raise exception '客户归属已改变，不能提交此PI草稿';
  end if;
  if not exists (select 1 from public.pi_payment_accounts a where a.id=target.payment_account_id
    and a.active=true and a.payment_channel=(case when target.payment_method in ('T/T Bank Transfer','Alipay','PayPal','Wise Transfer','Payoneer Transfer') then target.payment_method else 'OTHER' end)) then
    raise exception '收款账户已停用，请重新选择';
  end if;
  if target.pi_valid_until<current_date then raise exception 'PI有效期已过，请修改后提交'; end if;
  select * into usd_reference from public.pi_exchange_rate_snapshots
    where currency='USD' and source='BAIDU_FINSCOPE'
      and cny_per_unit>0 and synced_at >= now()-interval '15 minutes'
    order by synced_at desc limit 1;
  if usd_reference.currency is null then raise exception '百度美元参考汇率暂不可用，请稍后重试'; end if;

  if stock.id is null then
    stock_no:=public.next_stock_order_number();
    insert into public.stock_orders(quote_id,sales_order_id,quote_number,order_number,warehouse_reference_number,stock_number,sales_user_id,
      customer_short_name,destination_country,status,stocking_requirements,delivery_recipient,delivery_phone,delivery_email,delivery_address,updated_by)
    values(target.quote_id,target.id,target.quote_number,target.order_number,target.warehouse_reference_number,stock_no,target.sales_user_id,
      target.customer_short_name,target.destination_country,'WAITING',target_quote.stocking_requirements,
      target.delivery_recipient,target.delivery_phone,target.delivery_email,target.delivery_address,actor.id)
    returning * into stock;
  else
    update public.stock_orders set status='WAITING',status_note=null,warehouse_reference_number=target.warehouse_reference_number,
      stocking_requirements=target_quote.stocking_requirements,
      delivery_recipient=target.delivery_recipient,delivery_phone=target.delivery_phone,
      delivery_email=target.delivery_email,delivery_address=target.delivery_address,
      updated_by=actor.id,updated_at=now() where id=stock.id returning * into stock;
    delete from public.stock_order_items where stock_order_id=stock.id;
  end if;
  insert into public.stock_order_items(stock_order_id,line_number,item_name,brand,model,quality,description,description_zh,
    procurement_cost,estimated_unit_cost_cny,quantity,preparation_requirement,internal_note)
  select stock.id,line_number,item_name,brand,model,quality,description,description_zh,0,unit_cost_cny,quantity,
    preparation_requirement,internal_note from public.quote_items where quote_id=target.quote_id order by line_number;
  update public.quotes set status='CONFIRMED',customer_confirmed_at=now(),confirmed_by=actor.id,updated_at=now()
    where id=target.quote_id;
  update public.sales_orders set status='WAITING_STOCK',confirmed_at=now(),confirmed_by=actor.id,
    usd_cny_rate_snapshot=usd_reference.cny_per_unit,
    usd_rate_source_snapshot=usd_reference.source,
    usd_rate_reference_date_snapshot=usd_reference.reference_date,
    usd_rate_synced_at_snapshot=usd_reference.synced_at,
    pi_revision=pi_revision+1,updated_at=now() where id=target.id returning * into result;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(stock.id,case when stock_no is null then 'DRAFT' else null end,'WAITING','销售员确认PI并提交仓库',actor.id);
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'STOCK_ORDER_CREATED','STOCK','收到新备货单',format('PI订单 %s 已提交仓库，请安排备货。',target.order_number),
    '/stock-orders/'||stock.id,'stock_order',stock.id,'pi-stock:'||stock.id||':'||result.pi_revision,'PENDING'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_SUBMIT','sales_order',target.id,
    jsonb_build_object('revision',result.pi_revision,'stock_order_id',stock.id,'total_cny',result.total_cny,
      'usd_cny_rate_snapshot',result.usd_cny_rate_snapshot,'usd_rate_source_snapshot',result.usd_rate_source_snapshot,
      'usd_rate_reference_date_snapshot',result.usd_rate_reference_date_snapshot));
  return result;
end $function$;
