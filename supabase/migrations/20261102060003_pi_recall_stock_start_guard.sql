-- Recalling before warehouse processing must not erase any physical progress.
-- The stock-order row lock serializes this check with stock progress RPCs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Requirement images belong to the PI, so warehouse readers can see the same
-- evidence without duplicating objects when the stock order is regenerated.
alter table public.attachments
  add column if not exists sales_order_id uuid references public.sales_orders(id) on delete cascade,
  add column if not exists sales_order_item_id uuid references public.sales_order_items(id) on delete set null,
  add column if not exists pi_line_number_snapshot integer,
  add column if not exists pi_product_label_snapshot text;
create index if not exists attachments_sales_order_requirement_idx
  on public.attachments(sales_order_id, created_at)
  where sales_order_id is not null;
-- Keep fully reversed receipt allocations linked to their original product.
-- A cancelled line remains as a zero-quantity tombstone for audit and print.
alter table public.sales_order_items add column pi_amendment_cancelled_at timestamptz;
alter table public.quote_items add column pi_amendment_cancelled_at timestamptz;
alter table public.stock_order_items add column pi_amendment_cancelled_at timestamptz;
alter table public.sales_order_items drop constraint if exists sales_order_items_quantity_check;
alter table public.sales_order_items add constraint sales_order_items_quantity_check
  check ((quantity > 0 and pi_amendment_cancelled_at is null)
    or (quantity = 0 and pi_amendment_cancelled_at is not null));
alter table public.quote_items drop constraint if exists quote_items_quantity_positive;
alter table public.quote_items add constraint quote_items_quantity_positive
  check ((quantity > 0 and pi_amendment_cancelled_at is null)
    or (quantity = 0 and pi_amendment_cancelled_at is not null));
alter table public.stock_order_items drop constraint if exists stock_order_items_quantity_check;
alter table public.stock_order_items drop constraint if exists stock_item_quantity_integer_check;
alter table public.stock_order_items add constraint stock_order_items_quantity_check
  check ((quantity > 0 and quantity = trunc(quantity) and pi_amendment_cancelled_at is null)
    or (quantity = 0 and pi_amendment_cancelled_at is not null));

-- The existing shipment guard considers 0/0 a fully shipped active line.
-- A cancelled zero-quantity tombstone is different and is only permitted
-- inside the locked, atomic PI amendment transaction.
create or replace function public.require_costed_stock_shipment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.pi_amendment_cancelled_at is not null and new.quantity=0 then
    if current_setting('app.pi_amendment_apply',true) is distinct from '1'
      or old.pi_amendment_cancelled_at is not null
      or new.received_quantity<>0 or new.prepared_quantity<>0 or new.shipped_quantity<>0 then
      raise exception '已删除PI产品行不得通过普通备货操作修改';
    end if;
    return new;
  end if;
  if (new.preparation_status is distinct from old.preparation_status
      or new.shipped_quantity is distinct from old.shipped_quantity)
    and ((new.shipped_quantity = new.quantity and new.preparation_status <> 'SHIPPED')
      or (new.shipped_quantity <> new.quantity and new.preparation_status = 'SHIPPED')) then
    raise exception '产品发货数量与单项状态不一致，请刷新后重试';
  end if;
  if new.shipped_quantity is distinct from old.shipped_quantity
    and current_setting('app.costed_stock_shipment', true) is distinct from '1' then
    raise exception '交货代请刷新页面并通过填写三项人民币费用的发货入口操作';
  end if;
  if new.shipped_quantity > old.shipped_quantity
    and (nullif(btrim(new.warehouse_supplier_code), '') is null
      or new.procurement_cost_confirmed is not true
      or new.procurement_cost is null) then
    raise exception '请先填写并保存供应商编码和有效采购价，再交货代';
  end if;
  return new;
end;
$$;

create or replace function public.sync_stock_item_status_from_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status
    and current_setting('app.stock_item_transition',true) is distinct from '1'
    and new.status in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED') then
    update public.stock_order_items set preparation_status=new.status
      where stock_order_id=new.id and pi_amendment_cancelled_at is null;
  end if;
  return new;
end;
$$;
create or replace function public.recall_direct_pi_order(p_order_id uuid,p_reason text)
returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.sales_orders;
  stock public.stock_orders;
  result public.sales_orders;
  reason text := btrim(coalesce(p_reason,''));
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或PI订单不存在'; end if;
  if target.confirmation_method<>'DIRECT_PI'
    or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id then
    raise exception '只有创建该PI的账号可以撤回';
  end if;
  if not public.current_user_has_business_permission('orders.edit') then
    raise exception '没有PI订单编辑权限';
  end if;
  if target.status<>'WAITING_STOCK' or stock.id is null or stock.status<>'WAITING'
    or exists (select 1 from public.stock_order_items i where i.stock_order_id=stock.id
      and (i.preparation_status<>'WAITING' or i.received_quantity<>0
        or i.prepared_quantity<>0 or i.shipped_quantity<>0)) then
    raise exception '仓库已开始处理或状态已改变，不能直接撤回，请走变更处理';
  end if;
  if reason='' or length(reason)>500 then raise exception '请填写500字以内的撤回原因'; end if;
  update public.stock_orders set status='DRAFT',status_note=reason,updated_by=actor.id,updated_at=now()
    where id=stock.id;
  update public.quotes set status='DRAFT',customer_confirmed_at=null,confirmed_by=null,updated_at=now()
    where id=target.quote_id;
  update public.sales_orders set status='DRAFT',confirmed_at=null,confirmed_by=null,
    pi_revision=pi_revision+1,updated_at=now() where id=target.id returning * into result;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(stock.id,'WAITING','DRAFT','PI撤回：'||reason,actor.id);
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'STOCK_STATUS_CHANGED','STOCK','PI备货单已撤回',format('PI订单 %s 已撤回，请勿继续备货：%s',target.order_number,reason),
    '/stock-orders/'||stock.id,'stock_order',stock.id,'pi-recall:'||stock.id||':'||result.pi_revision,'INFO'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_RECALL','sales_order',target.id,
    jsonb_build_object('reason',reason,'stock_order_id',stock.id,'revision',result.pi_revision));
  return result;
end;
$$;
revoke all on function public.recall_direct_pi_order(uuid,text) from public,anon;
grant execute on function public.recall_direct_pi_order(uuid,text) to authenticated;

-- Keep older draft-write functions aligned with the existing submit function:
-- the preparer, not the sales owner of a clerk-prepared PI, controls edits.
do $$
declare
  definition text;
  previous text;
  old_guard text := '(actor.role=''ORDER_CLERK'' and target.prepared_by is distinct from actor.id) or (actor.role<>''ORDER_CLERK'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN'')';
begin
  definition := pg_get_functiondef('public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  previous := definition;
  definition := replace(definition,old_guard,
    'coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id');
  if definition<>previous then execute definition;
  elsif position('target.prepared_by is distinct from actor.id' in definition)=0
    and position('coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id' in definition)=0 then
    raise exception 'PI draft creator guard changed; manual review required';
  end if;

  definition := pg_get_functiondef('public.set_direct_pi_change_note(uuid,integer,text)'::regprocedure);
  previous := definition;
  definition := replace(definition,old_guard,
    'coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id');
  if definition<>previous then execute definition;
  elsif position('target.prepared_by is distinct from actor.id' in definition)=0
    and position('coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id' in definition)=0 then
    raise exception 'PI change-note creator guard changed; manual review required';
  end if;

  definition := pg_get_functiondef('public.delete_never_submitted_pi_draft(uuid,integer)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'if actor.role<>''ADMIN'' and target.sales_user_id<>actor.id then',
    'if coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id then');
  if definition<>previous then execute definition;
  elsif position('target.prepared_by is distinct from actor.id' in definition)=0
    and position('coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id' in definition)=0 then
    raise exception 'PI draft delete creator guard changed; manual review required';
  end if;

  definition := pg_get_functiondef('public.cancel_sales_order(uuid,text)'::regprocedure);
  previous := definition;
  -- The page/action grant is configurable. A preparer may cancel only the
  -- direct PI they created; the old blanket clerk ban would ignore that grant.
  definition := replace(definition,
    'if actor.id is null or target.id is null or actor.role=''ORDER_CLERK'' then',
    'if actor.id is null or target.id is null then');
  if definition=previous then
    definition := replace(definition,
      'if actor.id is null or target.id is null or (actor.role=''ORDER_CLERK'' and target.confirmation_method<>''DIRECT_PI'') then',
      'if actor.id is null or target.id is null then');
  end if;
  if definition=previous then
    raise exception 'PI cancel clerk guard changed; manual review required';
  end if;
  previous := definition;
  definition := replace(definition,
    'if target.sales_user_id<>actor.id and actor.role<>''ADMIN'' then',
    'if (target.confirmation_method=''DIRECT_PI'' and coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id) or (target.confirmation_method<>''DIRECT_PI'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN'') then');
  if definition=previous then
    definition := replace(definition,
      'target.confirmation_method=''DIRECT_PI'' and target.prepared_by is distinct from actor.id',
      'target.confirmation_method=''DIRECT_PI'' and coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id');
  end if;
  if definition<>previous then execute definition;
  elsif position('target.confirmation_method=''DIRECT_PI'' and target.prepared_by is distinct from actor.id' in definition)=0
    and position('target.confirmation_method=''DIRECT_PI'' and coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id' in definition)=0 then
    raise exception 'PI cancel creator guard changed; manual review required';
  end if;
end $$;

-- Shipment is a historical hand-off, not an editable PI draft. Keep its
-- product identity and commercial estimate immutable even if a future API
-- accidentally issues a direct stock-item UPDATE instead of the amendment RPC.
create function public.prevent_shipped_stock_line_amendment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.shipped_quantity > 0 then
      raise exception '第%项已有交货代数量，不能删除产品记录',old.line_number;
    end if;
    if old.received_quantity > 0 or old.prepared_quantity > 0 then
      raise exception '第%项已有回货或理货记录，须先核对实物并冲正后才能删除',old.line_number;
    end if;
    return old;
  end if;
  if old.shipped_quantity > 0 and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception '第%项已有交货代数量，不能变更已发货产品记录',old.line_number;
  end if;
  -- The approved amendment RPC has already checked physical quantities and
  -- holds the parent stock-order lock. It may increase an unshipped line's
  -- ordered quantity without rewriting its immutable receipt allocations.
  if current_setting('app.pi_amendment_apply',true)='1'
    and old.shipped_quantity=0 and new.quantity>=old.received_quantity
    and new.quantity>=old.prepared_quantity then return new; end if;
  if old.received_quantity > 0 and (
    new.quantity is distinct from old.quantity
    or new.item_name is distinct from old.item_name
    or new.brand is distinct from old.brand
    or new.model is distinct from old.model
    or new.quality is distinct from old.quality
    or new.description is distinct from old.description
    or new.product_type_snapshot is distinct from old.product_type_snapshot
    or new.estimated_unit_cost_cny is distinct from old.estimated_unit_cost_cny
  ) then
    raise exception '第%项已有实物回货，须先由仓库核对并冲正或重新分配，才能生效PI产品变更',old.line_number;
  end if;
  return new;
end;
$$;
create trigger shipped_stock_line_amendment_guard
before update or delete on public.stock_order_items
for each row execute function public.prevent_shipped_stock_line_amendment();
revoke all on function public.prevent_shipped_stock_line_amendment() from public,anon,authenticated;

-- A seller's revised cost estimate is accounting metadata, not a change to a
-- shipped PI product or the confidential warehouse purchase ledger. Keep the
-- submitted quote and stock product snapshot intact and audit every revision.
create table public.pi_seller_cost_reviews (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  sales_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
  previous_unit_cost_cny numeric(14,2) not null check (previous_unit_cost_cny >= 0),
  revised_unit_cost_cny numeric(14,2) not null check (revised_unit_cost_cny >= 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  reviewed_by uuid not null references public.users(id),
  reviewed_at timestamptz not null default now(),
  constraint pi_seller_cost_review_changed check (previous_unit_cost_cny <> revised_unit_cost_cny)
);
create index pi_seller_cost_reviews_order_idx
  on public.pi_seller_cost_reviews(sales_order_id,reviewed_at desc);
alter table public.pi_seller_cost_reviews enable row level security;
revoke all on public.pi_seller_cost_reviews from public,anon,authenticated;
grant select on public.pi_seller_cost_reviews to service_role;
insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('SALES','orders.cost_review',true),
  ('SUPERVISOR','orders.cost_review',true),
  ('ORDER_CLERK','orders.cost_review',true)
on conflict(role_code,permission_code) do nothing;

create function public.review_shipped_pi_seller_cost(
  p_order_id uuid, p_item_id uuid, p_expected_unit_cost_cny numeric,
  p_revised_unit_cost_cny numeric, p_reason text
) returns public.sales_order_items
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.sales_orders;
  stock public.stock_orders;
  line public.sales_order_items;
  revised public.sales_order_items;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null or stock.id is null
    or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or actor.role not in ('SALES','SUPERVISOR','ORDER_CLERK','ADMIN')
    or not public.current_user_has_business_permission('orders.cost_review') then
    raise exception '无此PI销售成本复核权限';
  end if;
  if target.confirmation_method<>'DIRECT_PI' or target.status<>'SHIPPED'
    or stock.status<>'SHIPPED'
    or not exists(select 1 from public.stock_order_items i where i.stock_order_id=stock.id
      and i.pi_amendment_cancelled_at is null)
    or exists(select 1 from public.stock_order_items i where i.stock_order_id=stock.id
      and i.pi_amendment_cancelled_at is null
      and i.shipped_quantity is distinct from i.quantity) then
    raise exception '整单全部交货代后才可复核销售预估成本';
  end if;
  if p_revised_unit_cost_cny is null or p_revised_unit_cost_cny<0
    or p_revised_unit_cost_cny>999999999999.99
    or p_revised_unit_cost_cny<>round(p_revised_unit_cost_cny,2)
    or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception '请填写有效的人民币成本单价和500字以内的复核原因';
  end if;
  select * into line from public.sales_order_items
    where id=p_item_id and sales_order_id=target.id
      and pi_amendment_cancelled_at is null for update;
  if line.id is null or line.estimated_unit_cost_cny is null
    or line.estimated_unit_cost_cny is distinct from p_expected_unit_cost_cny then
    raise exception '该产品成本已变化，请刷新后核对';
  end if;
  if line.estimated_unit_cost_cny=p_revised_unit_cost_cny then
    raise exception '复核后的成本与当前成本相同';
  end if;
  update public.sales_order_items set estimated_unit_cost_cny=p_revised_unit_cost_cny
    where id=line.id returning * into revised;
  insert into public.pi_seller_cost_reviews(sales_order_id,sales_order_item_id,
    previous_unit_cost_cny,revised_unit_cost_cny,reason,reviewed_by)
  values(target.id,line.id,line.estimated_unit_cost_cny,p_revised_unit_cost_cny,
    btrim(p_reason),actor.id);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_SELLER_COST_REVIEW','sales_order',target.id,
    jsonb_build_object('item_id',line.id,'line_number',line.line_number,
      'previous_unit_cost_cny',line.estimated_unit_cost_cny,
      'revised_unit_cost_cny',p_revised_unit_cost_cny,'reason',btrim(p_reason)));
  return revised;
end;
$$;
revoke all on function public.review_shipped_pi_seller_cost(uuid,uuid,numeric,numeric,text)
  from public,anon;
grant execute on function public.review_shipped_pi_seller_cost(uuid,uuid,numeric,numeric,text)
  to authenticated;

create function public.notify_pi_seller_cost_review_after_handoff()
returns trigger language plpgsql set search_path = '' as $$
declare
  target public.sales_orders;
begin
  if new.status='SHIPPED' and old.status is distinct from new.status then
    select * into target from public.sales_orders where id=new.sales_order_id;
    if target.confirmation_method='DIRECT_PI' then
      insert into public.system_notifications
        (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
      values(coalesce(target.prepared_by,target.sales_user_id),'STOCK_STATUS_CHANGED','STOCK','PI整单已交货代，请复核销售成本',
        format('PI订单 %s 已整单交货代。请按已知业务情况复核您录入的成本估计；实际采购价不会向销售员展示。',target.order_number),
        '/orders/'||target.id,'sales_order',target.id,'pi-seller-cost-review:'||target.id,'PENDING')
      on conflict(recipient_id,dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;
  return new;
end;
$$;
create trigger pi_seller_cost_review_after_handoff
after update of status on public.stock_orders
for each row execute function public.notify_pi_seller_cost_review_after_handoff();
revoke all on function public.notify_pi_seller_cost_review_after_handoff()
  from public,anon,authenticated;

-- A post-start PI amendment is a versioned proposal, never an in-place edit.
-- Only approved proposals count toward the three-change allowance.
create table public.pi_amendment_requests (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  stock_order_id uuid not null references public.stock_orders(id) on delete restrict,
  base_revision integer not null check(base_revision > 0),
  requested_by uuid not null references public.users(id),
  reason text not null check(char_length(btrim(reason)) between 1 and 500),
  before_items jsonb not null,
  proposed_items jsonb not null,
  affected_stock_item_ids uuid[] not null,
  status text not null default 'PENDING' check(status in ('PENDING','APPLIED','REJECTED','WITHDRAWN')),
  decided_by uuid references public.users(id),
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_revision integer,
  constraint pi_amendment_decision_consistent check (
    (status='PENDING' and decided_at is null and decided_by is null and applied_revision is null)
    or (status<>'PENDING' and decided_at is not null and decided_by is not null)
  )
);
create unique index pi_amendment_one_pending_per_order
  on public.pi_amendment_requests(sales_order_id) where status='PENDING';
create index pi_amendment_order_history
  on public.pi_amendment_requests(sales_order_id,created_at desc);
alter table public.pi_amendment_requests enable row level security;
revoke all on public.pi_amendment_requests from public,anon,authenticated;
grant select on public.pi_amendment_requests to service_role;

create function public.request_direct_pi_amendment(
  p_order_id uuid,p_expected_revision integer,p_items jsonb,p_reason text
) returns public.pi_amendment_requests
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.sales_orders;
  stock public.stock_orders;
  line public.sales_order_items;
  current_stock public.stock_order_items;
  proposed record;
  before_snapshot jsonb;
  affected uuid[] := '{}';
  changed boolean := false;
  result public.pi_amendment_requests;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null or stock.id is null
    or actor.role not in ('SALES','SUPERVISOR','ORDER_CLERK','ADMIN')
    or target.confirmation_method<>'DIRECT_PI'
    or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or not public.current_user_has_business_permission('orders.edit') then
    raise exception '只有此PI创建人可以申请变更';
  end if;
  if target.pi_revision is distinct from p_expected_revision
    or target.status not in ('PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHORTAGE')
    or stock.status not in ('PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHORTAGE') then
    raise exception 'PI或备货状态已改变，请刷新后核对';
  end if;
  if (select count(*) from public.pi_amendment_requests
      where sales_order_id=target.id and status='APPLIED') >= 3 then
    raise exception '此PI仓库开始处理后已完成3次变更';
  end if;
  if exists(select 1 from public.pi_amendment_requests
      where sales_order_id=target.id and status='PENDING') then
    raise exception '已有待仓库确认的PI变更，请先处理';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 500
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 500 then
    raise exception '请填写变更原因及1至500项有效产品';
  end if;
  if (select count(*) from jsonb_to_recordset(p_items) as x(id uuid))
      <> (select count(distinct x.id) from jsonb_to_recordset(p_items) as x(id uuid)) then
    raise exception '产品行标识不可为空或重复';
  end if;
  for proposed in select * from jsonb_to_recordset(p_items) as x(
    id uuid,item_name text,brand text,model text,quality text,description text,
    description_zh text,preparation_requirement text,internal_note text,
    quantity numeric,unit_price_cny numeric,estimated_unit_cost_cny numeric) loop
    if proposed.id is null or nullif(btrim(coalesce(proposed.item_name,'')),'') is null
      or nullif(btrim(coalesce(proposed.brand,'')),'') is null
      or nullif(btrim(coalesce(proposed.model,'')),'') is null
      or nullif(btrim(coalesce(proposed.quality,'')),'') is null
      or proposed.quantity is null or proposed.quantity <= 0
      or proposed.quantity <> trunc(proposed.quantity)
      or proposed.unit_price_cny is null or proposed.unit_price_cny < 0
      or proposed.unit_price_cny <> round(proposed.unit_price_cny,2)
      or proposed.estimated_unit_cost_cny is null or proposed.estimated_unit_cost_cny < 0
      or proposed.estimated_unit_cost_cny <> round(proposed.estimated_unit_cost_cny,2) then
      raise exception '变更产品缺少必填资料或数量、价格不正确';
    end if;
    if exists(select 1 from public.sales_order_items i where i.id=proposed.id
      and i.sales_order_id<>target.id) then
      raise exception '产品行不属于此PI';
    end if;
    if exists(select 1 from public.sales_order_items i where i.id=proposed.id
      and i.sales_order_id=target.id and i.pi_amendment_cancelled_at is not null) then
      raise exception '已取消的历史产品行不可复用，请新增产品行';
    end if;
  end loop;
  for line in select * from public.sales_order_items
    where sales_order_id=target.id and pi_amendment_cancelled_at is null
    order by line_number for update loop
    select * into current_stock from public.stock_order_items
      where stock_order_id=stock.id and line_number=line.line_number for update;
    if current_stock.id is null then raise exception 'PI与备货产品行不一致，请联系管理员'; end if;
    select * into proposed from jsonb_to_recordset(p_items) as x(
      id uuid,item_name text,brand text,model text,quality text,description text,
      description_zh text,preparation_requirement text,internal_note text,
      quantity numeric,unit_price_cny numeric,estimated_unit_cost_cny numeric)
      where x.id=line.id;
    if not found or row(proposed.item_name,proposed.brand,proposed.model,proposed.quality,
      proposed.description,proposed.description_zh,proposed.preparation_requirement,
      proposed.internal_note,proposed.quantity,proposed.unit_price_cny,
      proposed.estimated_unit_cost_cny) is distinct from
      row(line.item_name,line.brand,line.model,line.quality,line.description,
      line.description_zh,line.preparation_requirement,line.internal_note,
      line.quantity,line.unit_price_cny,line.estimated_unit_cost_cny) then
      if current_stock.shipped_quantity>0 then
        raise exception '第%项已有交货代数量，不允许变更或删除',line.line_number;
      end if;
      affected:=array_append(affected,current_stock.id);
      changed:=true;
    end if;
  end loop;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(id uuid)
    where not exists(select 1 from public.sales_order_items i
      where i.id=x.id and i.sales_order_id=target.id
        and i.pi_amendment_cancelled_at is null)) then changed:=true; end if;
  if not changed then raise exception '订单内容没有变化'; end if;
  select jsonb_agg(to_jsonb(i) - 'amount' order by i.line_number)
    into before_snapshot from public.sales_order_items i
    where i.sales_order_id=target.id and i.pi_amendment_cancelled_at is null;
  insert into public.pi_amendment_requests(sales_order_id,stock_order_id,base_revision,
    requested_by,reason,before_items,proposed_items,affected_stock_item_ids)
  values(target.id,stock.id,target.pi_revision,actor.id,btrim(p_reason),before_snapshot,p_items,affected)
  returning * into result;
  insert into public.system_notifications
    (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'PI_CHANGE_REQUESTED','STOCK','紧急：PI订单变更待确认',
    format('PI %s 的创建人已申请变更；涉及 %s 项原产品，请先核对变更与实物。',
      target.order_number,cardinality(affected)),
    '/stock-orders/'||stock.id,'stock_order',stock.id,'pi-change:'||result.id||':'||u.id,'PENDING'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_CHANGE_REQUESTED','sales_order',target.id,
    jsonb_build_object('request_id',result.id,'revision',target.pi_revision,'reason',result.reason));
  return result;
end;
$$;
revoke all on function public.request_direct_pi_amendment(uuid,integer,jsonb,text)
  from public,anon;
grant execute on function public.request_direct_pi_amendment(uuid,integer,jsonb,text)
  to authenticated;

create function public.prevent_pending_pi_amendment_progress()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.pi_amendment_apply',true)='1' then return new; end if;
  if exists(select 1 from public.pi_amendment_requests r
      where r.stock_order_id=old.stock_order_id and r.status='PENDING'
        and old.id=any(r.affected_stock_item_ids))
    and (new.received_quantity>old.received_quantity
      or new.prepared_quantity>old.prepared_quantity
      or new.shipped_quantity>old.shipped_quantity
      or new.procurement_cost is distinct from old.procurement_cost
      or new.preparation_status is distinct from old.preparation_status
        and new.received_quantity>=old.received_quantity
        and new.prepared_quantity>=old.prepared_quantity) then
    raise exception '此产品有待确认PI变更，暂停新增回货、采购价、理货与交货代';
  end if;
  return new;
end;
$$;
create trigger pending_pi_amendment_progress_guard
before update on public.stock_order_items
for each row execute function public.prevent_pending_pi_amendment_progress();
revoke all on function public.prevent_pending_pi_amendment_progress()
  from public,anon,authenticated;

create function public.prevent_pending_pi_amendment_full_handoff()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status='SHIPPED' and old.status is distinct from new.status
    and exists(select 1 from public.pi_amendment_requests r
      where r.stock_order_id=new.id and r.status='PENDING') then
    raise exception 'PI变更待确认，不能整单交货代';
  end if;
  return new;
end;
$$;
create trigger pending_pi_amendment_full_handoff_guard
before update of status on public.stock_orders
for each row execute function public.prevent_pending_pi_amendment_full_handoff();
revoke all on function public.prevent_pending_pi_amendment_full_handoff()
  from public,anon,authenticated;

create function public.decide_direct_pi_amendment(
  p_request_id uuid,p_approve boolean,p_reason text
) returns public.pi_amendment_requests
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  request_row public.pi_amendment_requests;
  stock public.stock_orders;
  target public.sales_orders;
  old_line public.sales_order_items;
  stock_line public.stock_order_items;
  candidate record;
  next_line integer;
  new_subtotal_cny numeric;
  new_subtotal_payment numeric;
  base_cny numeric;
  base_payment numeric;
  paypal_cny numeric;
  paypal_payment numeric;
  next_status text;
  total_ordered bigint;
  total_received bigint;
  total_prepared bigint;
  started_count bigint;
  result public.pi_amendment_requests;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into request_row from public.pi_amendment_requests where id=p_request_id;
  if request_row.id is null then raise exception 'PI变更申请不存在'; end if;
  select * into stock from public.stock_orders where id=request_row.stock_order_id for update;
  select * into target from public.sales_orders where id=request_row.sales_order_id for update;
  select * into request_row from public.pi_amendment_requests where id=p_request_id for update;
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '只有获授权仓库员可以确认PI变更';
  end if;
  if request_row.status<>'PENDING' or stock.id is null or target.id is null
    or stock.sales_order_id<>target.id
    or target.pi_revision<>request_row.base_revision
    or stock.status='SHIPPED' then
    raise exception 'PI变更申请或备货版本已变化，请刷新后核对';
  end if;
  if not p_approve then
    if char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
      raise exception '驳回PI变更须填写原因';
    end if;
    update public.pi_amendment_requests set status='REJECTED',decided_by=actor.id,
      decision_note=btrim(p_reason),decided_at=now()
      where id=request_row.id returning * into result;
  else
    if (select count(*) from public.pi_amendment_requests
        where sales_order_id=target.id and status='APPLIED')>=3 then
      raise exception '此PI已达到仓库开始处理后的3次变更上限';
    end if;
    if target.fx_rate_cny_to_payment is null or target.fx_rate_cny_to_payment<=0 then
      raise exception 'PI付款汇率快照缺失，不能变更金额';
    end if;
    perform set_config('app.pi_amendment_apply','1',true);
    select coalesce(max(line_number),0) into next_line
      from public.sales_order_items where sales_order_id=target.id;
    for old_line in select * from public.sales_order_items
      where sales_order_id=target.id and pi_amendment_cancelled_at is null
      order by line_number for update loop
      select * into candidate from jsonb_to_recordset(request_row.proposed_items) as x(
        id uuid,item_name text,brand text,model text,quality text,description text,
        description_zh text,preparation_requirement text,internal_note text,
        quantity numeric,unit_price_cny numeric,estimated_unit_cost_cny numeric)
        where x.id=old_line.id;
      select * into stock_line from public.stock_order_items
        where stock_order_id=stock.id and line_number=old_line.line_number for update;
      if stock_line.id is null then raise exception '第%项备货行缺失',old_line.line_number; end if;
      if candidate.id is null then
        if stock_line.received_quantity<>0 or stock_line.prepared_quantity<>0
          or stock_line.shipped_quantity<>0 then
          raise exception '第%项仍有实物或已交货代，不可删除；先核对退回/重新分配',old_line.line_number;
        end if;
        -- Keep a zero-quantity tombstone for every removed line. Receipt
        -- allocations, attachments and audit history may all reference its ID.
        update public.stock_order_items set quantity=0,preparation_status='WAITING',
          pi_amendment_cancelled_at=now() where id=stock_line.id;
        update public.quote_items set quantity=0,amount=0,
          pi_amendment_cancelled_at=now()
          where quote_id=target.quote_id and line_number=old_line.line_number;
        if not found then raise exception '第%项报价快照缺失',old_line.line_number; end if;
        update public.sales_order_items set quantity=0,amount=0,
          pi_amendment_cancelled_at=now() where id=old_line.id;
      elsif row(candidate.item_name,candidate.brand,candidate.model,candidate.quality,
          candidate.description,candidate.description_zh,candidate.preparation_requirement,
          candidate.internal_note,candidate.quantity,candidate.unit_price_cny,
          candidate.estimated_unit_cost_cny) is distinct from
          row(old_line.item_name,old_line.brand,old_line.model,old_line.quality,
          old_line.description,old_line.description_zh,old_line.preparation_requirement,
          old_line.internal_note,old_line.quantity,old_line.unit_price_cny,
          old_line.estimated_unit_cost_cny) then
        if stock_line.shipped_quantity<>0 or candidate.quantity<stock_line.received_quantity
          or candidate.quantity<stock_line.prepared_quantity then
          raise exception '第%项已交货代或数量低于实物进度，不能生效',old_line.line_number;
        end if;
        if stock_line.received_quantity>0 and row(candidate.item_name,candidate.brand,
            candidate.model,candidate.quality) is distinct from
            row(old_line.item_name,old_line.brand,old_line.model,old_line.quality) then
          raise exception '第%项已回货，须先冲正/重新分配实物才能替换产品',old_line.line_number;
        end if;
        update public.sales_order_items set item_name=btrim(candidate.item_name),
          brand=btrim(candidate.brand),model=btrim(candidate.model),quality=btrim(candidate.quality),
          description=coalesce(candidate.description,''),description_zh=btrim(candidate.description_zh),
          preparation_requirement=nullif(btrim(coalesce(candidate.preparation_requirement,'')),''),
          internal_note=nullif(btrim(coalesce(candidate.internal_note,'')),''),
          quantity=candidate.quantity,unit_price_cny=candidate.unit_price_cny,
          unit_price=round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2),
          amount=round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2)*candidate.quantity,
          estimated_unit_cost_cny=candidate.estimated_unit_cost_cny where id=old_line.id;
        update public.quote_items set item_name=btrim(candidate.item_name),
          brand=btrim(candidate.brand),model=btrim(candidate.model),quality=btrim(candidate.quality),
          description=coalesce(candidate.description,''),description_zh=btrim(candidate.description_zh),
          preparation_requirement=nullif(btrim(coalesce(candidate.preparation_requirement,'')),''),
          internal_note=nullif(btrim(coalesce(candidate.internal_note,'')),''),
          quantity=candidate.quantity,unit_price_cny=candidate.unit_price_cny,
          unit_price=round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2),
          amount=round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2)*candidate.quantity,
          unit_cost_cny=candidate.estimated_unit_cost_cny
          where quote_id=target.quote_id and line_number=old_line.line_number;
        if not found then raise exception '第%项报价快照缺失',old_line.line_number; end if;
        update public.stock_order_items set item_name=btrim(candidate.item_name),
          brand=btrim(candidate.brand),model=btrim(candidate.model),quality=btrim(candidate.quality),
          description=coalesce(candidate.description,''),description_zh=btrim(candidate.description_zh),
          preparation_requirement=nullif(btrim(coalesce(candidate.preparation_requirement,'')),''),
          internal_note=nullif(btrim(coalesce(candidate.internal_note,'')),''),
          quantity=candidate.quantity,estimated_unit_cost_cny=candidate.estimated_unit_cost_cny,
          preparation_status=case when candidate.quantity>old_line.quantity
            and stock_line.prepared_quantity<candidate.quantity then 'PREPARING'
            else stock_line.preparation_status end
          where id=stock_line.id;
      end if;
    end loop;
    for candidate in select * from jsonb_to_recordset(request_row.proposed_items) as x(
      id uuid,item_name text,brand text,model text,quality text,description text,
      description_zh text,preparation_requirement text,internal_note text,
      quantity numeric,unit_price_cny numeric,estimated_unit_cost_cny numeric) loop
      if exists(select 1 from public.sales_order_items i where i.id=candidate.id
        and i.sales_order_id=target.id and i.pi_amendment_cancelled_at is null) then continue; end if;
      if exists(select 1 from jsonb_to_recordset(request_row.before_items) as x(id uuid)
        where x.id=candidate.id) then
        raise exception '变更产品行与旧行冲突，请重新申请';
      end if;
      next_line:=next_line+1;
      insert into public.sales_order_items(id,sales_order_id,line_number,item_name,brand,model,
        quality,description,description_zh,quantity,unit_price,unit_price_cny,amount,
        estimated_unit_cost_cny,preparation_requirement,internal_note)
      values(candidate.id,target.id,next_line,btrim(candidate.item_name),btrim(candidate.brand),
        btrim(candidate.model),btrim(candidate.quality),coalesce(candidate.description,''),
        btrim(candidate.description_zh),candidate.quantity,
        round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2),candidate.unit_price_cny,
        round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2)*candidate.quantity,
        candidate.estimated_unit_cost_cny,
        nullif(btrim(coalesce(candidate.preparation_requirement,'')),''),
        nullif(btrim(coalesce(candidate.internal_note,'')),''));
      insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,
        description,description_zh,quantity,unit_price,unit_price_cny,amount,unit_cost_cny,
        procurement_cost,preparation_requirement,internal_note)
      values(target.quote_id,next_line,btrim(candidate.item_name),btrim(candidate.brand),
        btrim(candidate.model),btrim(candidate.quality),coalesce(candidate.description,''),
        btrim(candidate.description_zh),candidate.quantity,
        round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2),candidate.unit_price_cny,
        round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2)*candidate.quantity,
        candidate.estimated_unit_cost_cny,0,
        nullif(btrim(coalesce(candidate.preparation_requirement,'')),''),
        nullif(btrim(coalesce(candidate.internal_note,'')),''));
      insert into public.stock_order_items(stock_order_id,line_number,item_name,brand,model,
        quality,description,description_zh,quantity,procurement_cost,estimated_unit_cost_cny,
        preparation_requirement,internal_note)
      values(stock.id,next_line,btrim(candidate.item_name),btrim(candidate.brand),
        btrim(candidate.model),btrim(candidate.quality),coalesce(candidate.description,''),
        btrim(candidate.description_zh),candidate.quantity,0,candidate.estimated_unit_cost_cny,
        nullif(btrim(coalesce(candidate.preparation_requirement,'')),''),
        nullif(btrim(coalesce(candidate.internal_note,'')),''));
    end loop;
    perform set_config('app.pi_amendment_apply','0',true);
    select coalesce(sum(i.quantity*i.unit_price_cny),0),
      coalesce(sum(i.quantity*i.unit_price),0)
      into new_subtotal_cny,new_subtotal_payment from public.sales_order_items i
      where i.sales_order_id=target.id;
    base_cny:=new_subtotal_cny+target.shipping_cny+coalesce(target.last_balance_cny,0)
      +coalesce(target.other_charge_cny,0)-coalesce(target.discount_cny,0);
    base_payment:=new_subtotal_payment+target.shipping_cost+coalesce(target.last_balance_amount,0)
      +coalesce(target.other_charge_amount,0)-coalesce(target.discount_amount,0);
    if base_cny<0 or base_payment<0 then raise exception '变更后折扣超过应付金额'; end if;
    paypal_cny:=round(base_cny*coalesce(target.paypal_fee_percent,0)/100,2);
    paypal_payment:=round(base_payment*coalesce(target.paypal_fee_percent,0)/100,2);
    select coalesce(sum(quantity),0),coalesce(sum(received_quantity),0),
      coalesce(sum(prepared_quantity),0),
      count(*) filter(where preparation_status<>'WAITING')
      into total_ordered,total_received,total_prepared,started_count
      from public.stock_order_items where stock_order_id=stock.id;
    if total_ordered=0 then raise exception '变更后备货单不能没有产品'; end if;
    next_status:=case
      when total_prepared=total_ordered then 'READY_TO_SHIP'
      when total_received=total_ordered and total_prepared>0 then 'SORTING'
      when total_received=total_ordered then 'RECEIVED'
      when started_count>0 then 'PREPARING'
      else 'WAITING' end;
    perform set_config('app.stock_item_transition','1',true);
    update public.stock_orders set status=next_status,updated_by=actor.id,
      updated_at=clock_timestamp() where id=stock.id;
    perform set_config('app.stock_item_transition','0',true);
    update public.sales_orders set subtotal_cny=new_subtotal_cny,subtotal=new_subtotal_payment,
      paypal_fee_cny=paypal_cny,paypal_fee_amount=paypal_payment,
      total_cny=base_cny+paypal_cny,total_amount=base_payment+paypal_payment,
      status=case when next_status='WAITING' then 'WAITING_STOCK' else next_status end,
      pi_revision=pi_revision+1,updated_at=now() where id=target.id returning * into target;
    update public.quotes set subtotal_cny=new_subtotal_cny,subtotal=new_subtotal_payment,
      paypal_fee_cny=paypal_cny,paypal_fee_amount=paypal_payment,
      total_cny=base_cny+paypal_cny,total_amount=base_payment+paypal_payment,
      amount=base_payment+paypal_payment,version=version+1,updated_at=now()
      where id=target.quote_id;
    update public.pi_amendment_requests set status='APPLIED',decided_by=actor.id,
      decision_note=nullif(btrim(coalesce(p_reason,'')),''),decided_at=now(),
      applied_revision=target.pi_revision where id=request_row.id returning * into result;
  end if;
  update public.system_notifications set action_status='RESOLVED'
    where dedupe_key like 'pi-change:'||request_row.id||':%';
  insert into public.system_notifications
    (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  values(request_row.requested_by,
    case when p_approve then 'PI_CHANGE_APPLIED' else 'PI_CHANGE_REJECTED' end,
    'STOCK',case when p_approve then 'PI变更已同步备货单' else 'PI变更被仓库驳回' end,
    format('PI %s 的变更%s。%s',target.order_number,
      case when p_approve then '已生效' else '未生效' end,
      coalesce(nullif(btrim(p_reason),''),'')),
    '/orders/'||target.id,'sales_order',target.id,
    'pi-change-decision:'||result.id,'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,case when p_approve then 'PI_CHANGE_APPLIED' else 'PI_CHANGE_REJECTED' end,
    'sales_order',target.id,jsonb_build_object('request_id',result.id,
      'revision',target.pi_revision,'decision_note',result.decision_note));
  return result;
end;
$$;
revoke all on function public.decide_direct_pi_amendment(uuid,boolean,text)
  from public,anon;
grant execute on function public.decide_direct_pi_amendment(uuid,boolean,text)
  to authenticated;

create function public.withdraw_direct_pi_amendment(p_order_id uuid,p_request_id uuid)
returns public.pi_amendment_requests
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  request_row public.pi_amendment_requests;
  stock public.stock_orders;
  target public.sales_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into request_row from public.pi_amendment_requests where id=p_request_id;
  if request_row.id is null then raise exception 'PI变更申请不存在'; end if;
  select * into stock from public.stock_orders where id=request_row.stock_order_id for update;
  select * into target from public.sales_orders where id=request_row.sales_order_id for update;
  select * into request_row from public.pi_amendment_requests where id=p_request_id for update;
  if actor.id is null or target.id is null or stock.id is null
    or request_row.sales_order_id is distinct from p_order_id
    or request_row.status<>'PENDING' or request_row.requested_by<>actor.id
    or coalesce(target.prepared_by,target.sales_user_id) is distinct from actor.id
    or not public.current_user_has_business_permission('orders.edit') then
    raise exception '只有此PI申请人可撤回待确认变更';
  end if;
  update public.pi_amendment_requests set status='WITHDRAWN',decided_by=actor.id,
    decision_note='申请人撤回',decided_at=now() where id=request_row.id returning * into request_row;
  update public.system_notifications set action_status='RESOLVED'
    where dedupe_key like 'pi-change:'||request_row.id||':%';
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_CHANGE_WITHDRAWN','sales_order',target.id,
    jsonb_build_object('request_id',request_row.id,'revision',target.pi_revision));
  return request_row;
end;
$$;
revoke all on function public.withdraw_direct_pi_amendment(uuid,uuid) from public,anon;
grant execute on function public.withdraw_direct_pi_amendment(uuid,uuid) to authenticated;
commit;
