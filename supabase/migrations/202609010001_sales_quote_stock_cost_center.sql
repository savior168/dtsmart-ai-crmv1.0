-- Minimal sales closed loop: quotation -> customer confirmation -> warehouse preparation.
-- Warehouse access is deliberately separated from customer contacts, sales price and profit.

alter table public.users drop constraint if exists users_role_v3_check;
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_v4_check
  check (role in ('ADMIN','SUPERVISOR','SALES','WAREHOUSE'));

alter table public.role_permission_settings drop constraint if exists role_permission_settings_role_code_check;
alter table public.role_permission_settings add constraint role_permission_settings_role_code_v4_check
  check (role_code in ('ADMIN','SUPERVISOR','SALES','WAREHOUSE'));

alter table public.quotes
  add column if not exists owner_id uuid references public.users(id),
  add column if not exists version integer not null default 1,
  add column if not exists subtotal numeric(14,2) not null default 0,
  add column if not exists shipping_cost numeric(14,2) not null default 0,
  add column if not exists total_amount numeric(14,2) not null default 0,
  add column if not exists payment_method text,
  add column if not exists delivery_date date,
  add column if not exists customer_short_name text,
  add column if not exists destination_country text,
  add column if not exists stocking_requirements text,
  add column if not exists customer_confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references public.users(id),
  add column if not exists sent_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

update public.quotes set owner_id = created_by where owner_id is null;
update public.quotes set subtotal = amount, total_amount = amount where total_amount = 0 and amount <> 0;
alter table public.quotes alter column owner_id set not null;
alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_v2_check
  check (status in ('DRAFT','GENERATED','SENT','CONFIRMED','EXPIRED','CANCELLED'));
alter table public.quotes add constraint quotes_version_check check (version > 0);

alter table public.quote_items
  add column if not exists line_number integer not null default 1,
  add column if not exists item_name text,
  add column if not exists brand text,
  add column if not exists model text,
  add column if not exists quality text,
  add column if not exists description_zh text,
  add column if not exists procurement_cost numeric(14,2) not null default 0,
  add column if not exists preparation_requirement text;
update public.quote_items set item_name = coalesce(nullif(item_name,''), description) where item_name is null or item_name = '';
alter table public.quote_items alter column item_name set not null;
alter table public.quote_items add constraint quote_items_quantity_positive check (quantity > 0);
alter table public.quote_items add constraint quote_items_prices_nonnegative check (unit_price >= 0 and procurement_cost >= 0);
create unique index if not exists quote_items_line_unique on public.quote_items(quote_id, line_number);
create index if not exists quotes_owner_updated_idx on public.quotes(owner_id, updated_at desc);
create index if not exists quotes_customer_updated_idx on public.quotes(customer_id, updated_at desc);

create table if not exists public.stock_orders (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quotes(id) on delete restrict,
  quote_number text not null,
  stock_number text not null unique,
  sales_user_id uuid not null references public.users(id),
  customer_short_name text not null,
  destination_country text,
  status text not null default 'WAITING' check (status in ('WAITING','PREPARING','READY','SHORTAGE','CANCELLED')),
  stocking_requirements text,
  status_note text,
  expected_ready_at timestamptz,
  ready_at timestamptz,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_order_items (
  id uuid primary key default gen_random_uuid(),
  stock_order_id uuid not null references public.stock_orders(id) on delete cascade,
  line_number integer not null,
  item_name text not null,
  brand text,
  model text,
  quality text,
  description text,
  description_zh text,
  procurement_cost numeric(14,2) not null default 0 check (procurement_cost >= 0),
  quantity numeric(12,2) not null check (quantity > 0),
  preparation_requirement text,
  unique(stock_order_id, line_number)
);

create table if not exists public.stock_order_events (
  id uuid primary key default gen_random_uuid(),
  stock_order_id uuid not null references public.stock_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists stock_orders_sales_updated_idx on public.stock_orders(sales_user_id, updated_at desc);
create index if not exists stock_orders_status_updated_idx on public.stock_orders(status, updated_at desc);
create index if not exists stock_events_order_created_idx on public.stock_order_events(stock_order_id, created_at desc);

alter table public.attachments
  add column if not exists quote_id uuid references public.quotes(id) on delete cascade,
  add column if not exists stock_order_id uuid references public.stock_orders(id) on delete cascade,
  add column if not exists original_filename text,
  add column if not exists kind text not null default 'GENERAL';
create index if not exists attachments_quote_idx on public.attachments(quote_id, created_at desc);
create index if not exists attachments_stock_idx on public.attachments(stock_order_id, created_at desc);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-attachments','crm-attachments',false,15728640,array[
  'image/jpeg','image/png','image/webp','application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.api_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  -- Immutable billing audit identifiers deliberately have no lifecycle foreign
  -- keys. Deleted users, customers or tasks must never erase or block cost
  -- history, and the source ledgers already contain such historical UUIDs.
  user_id uuid,
  customer_id uuid,
  task_id uuid,
  provider text not null,
  service text not null,
  operation text not null,
  model_or_sku text,
  request_id text,
  quantity numeric(18,6) not null default 1,
  unit text not null default 'REQUEST',
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  amount_usd numeric(14,6) not null default 0,
  amount_type text not null default 'ESTIMATED' check (amount_type in ('FREE','ESTIMATED','FINAL')),
  pricing_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists api_cost_request_unique on public.api_cost_ledger(provider, request_id) where request_id is not null;
create index if not exists api_cost_occurred_idx on public.api_cost_ledger(occurred_at desc);
create index if not exists api_cost_user_occurred_idx on public.api_cost_ledger(user_id, occurred_at desc);

-- The billing ledger is append-only. Resetting production statistics only
-- advances this reporting boundary; it never deletes real API call records.
create table if not exists public.cost_center_settings (
  id boolean primary key default true check(id),
  accounting_start_at timestamptz not null default '1970-01-01 00:00:00+00',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.cost_center_settings(id) values(true) on conflict(id) do nothing;

-- Copy every OpenAI billing event into the provider-neutral ledger.  Both ledgers
-- are append-only business records, so deleting a task or customer never changes
-- historical usage and cost totals.
insert into public.api_cost_ledger(user_id,customer_id,task_id,provider,service,operation,model_or_sku,request_id,quantity,unit,
  input_tokens,cached_input_tokens,output_tokens,amount_usd,amount_type,metadata,occurred_at)
select user_id,customer_id,task_id,'OPENAI','AI筛选','客户分析',model,source_call_id::text,1,'REQUEST',
  input_tokens,cached_input_tokens,output_tokens,cost_usd,'FINAL',
  jsonb_build_object('task_name',task_name,'task_number',task_number,'channel',channel,'call_status',call_status),occurred_at
from public.ai_screening_usage_ledger
on conflict (provider,request_id) where request_id is not null do nothing;

create or replace function public.copy_ai_usage_to_api_cost_ledger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.api_cost_ledger(user_id,customer_id,task_id,provider,service,operation,model_or_sku,request_id,quantity,unit,
    input_tokens,cached_input_tokens,output_tokens,amount_usd,amount_type,metadata,occurred_at)
  values(new.user_id,new.customer_id,new.task_id,'OPENAI','AI筛选','客户分析',new.model,new.source_call_id::text,1,'REQUEST',
    new.input_tokens,new.cached_input_tokens,new.output_tokens,new.cost_usd,'FINAL',
    jsonb_build_object('task_name',new.task_name,'task_number',new.task_number,'channel',new.channel,'call_status',new.call_status),new.occurred_at)
  on conflict (provider,request_id) where request_id is not null do nothing;
  return new;
end $$;
drop trigger if exists trg_copy_ai_usage_to_api_cost_ledger on public.ai_screening_usage_ledger;
create trigger trg_copy_ai_usage_to_api_cost_ledger after insert on public.ai_screening_usage_ledger
for each row execute function public.copy_ai_usage_to_api_cost_ledger();

create or replace function public.cost_center_summary(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.current_user_is_admin() then raise exception '仅系统管理员可以查看费用中心'; end if;
  select jsonb_build_object(
    'total_usd',coalesce(sum(amount_usd),0),
    'request_count',count(*),
    'input_tokens',coalesce(sum(input_tokens),0),
    'cached_input_tokens',coalesce(sum(cached_input_tokens),0),
    'output_tokens',coalesce(sum(output_tokens),0),
    'estimated_usd',coalesce(sum(amount_usd) filter(where amount_type='ESTIMATED'),0),
    'final_usd',coalesce(sum(amount_usd) filter(where amount_type='FINAL'),0),
    'unknown_pricing_count',count(*) filter(where amount_type='ESTIMATED' and coalesce((pricing_snapshot->>'pricing_configured')::boolean,false)=false),
    'providers',coalesce((select jsonb_agg(provider_row order by provider_row.total_usd desc) from (
      select provider,service,count(*) request_count,sum(amount_usd) total_usd,
        sum(case when amount_type='ESTIMATED' then amount_usd else 0 end) estimated_usd
      from public.api_cost_ledger where occurred_at>=p_from and occurred_at<p_to group by provider,service
    ) provider_row),'[]'::jsonb)
  ) into result from public.api_cost_ledger where occurred_at>=p_from and occurred_at<p_to;
  return result;
end $$;
grant execute on function public.cost_center_summary(timestamptz,timestamptz) to authenticated;

alter table public.system_notifications
  add column if not exists category text,
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists dedupe_key text,
  add column if not exists deliver_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz,
  add column if not exists action_status text not null default 'INFO';
alter table public.system_notifications drop constraint if exists system_notifications_action_status_check;
alter table public.system_notifications add constraint system_notifications_action_status_check
  check(action_status in ('INFO','PENDING','RESOLVED'));
create unique index if not exists system_notifications_dedupe_unique
  on public.system_notifications(recipient_id, dedupe_key) where dedupe_key is not null;
create index if not exists system_notifications_delivery_idx
  on public.system_notifications(recipient_id,deliver_at desc) where archived_at is null;

create or replace function public.schedule_followup_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare customer_name text;
begin
  if tg_op='DELETE' then
    delete from public.system_notifications where recipient_id=old.user_id and dedupe_key='followup-due:'||old.id;
    return old;
  end if;
  if tg_op='UPDATE' and new.next_follow_date is not distinct from old.next_follow_date then return new; end if;
  -- Logging a new follow-up resolves the previous reminder for the same
  -- customer. A new future date below creates the next actionable reminder.
  update public.system_notifications set action_status='RESOLVED',read_at=coalesce(read_at,now())
  where recipient_id=new.user_id and entity_type='followup' and action_status='PENDING'
    and entity_id in(select id from public.followups where user_id=new.user_id and customer_id=new.customer_id and id<>new.id);
  if new.next_follow_date is null then
    delete from public.system_notifications where recipient_id=new.user_id and dedupe_key='followup-due:'||new.id;
    return new;
  end if;
  select company_name into customer_name from public.customers where id=new.customer_id;
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,deliver_at,action_status,read_at,archived_at)
  values(new.user_id,'FOLLOWUP_DUE','FOLLOWUP','客户跟进提醒',
    format('客户“%s”已到计划跟进时间，请及时处理。',coalesce(customer_name,'未命名客户')),
    '/customers/'||new.customer_id,'followup',new.id,'followup-due:'||new.id,new.next_follow_date,'PENDING',null,null)
  on conflict(recipient_id,dedupe_key) where dedupe_key is not null do update set
    content=excluded.content,href=excluded.href,deliver_at=excluded.deliver_at,
    action_status='PENDING',read_at=null,archived_at=null;
  return new;
end $$;
drop trigger if exists trg_schedule_followup_notification on public.followups;
create trigger trg_schedule_followup_notification after insert or update or delete on public.followups
for each row execute function public.schedule_followup_notification();
insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,deliver_at,action_status)
select f.user_id,'FOLLOWUP_DUE','FOLLOWUP','客户跟进提醒',
  format('客户“%s”已到计划跟进时间，请及时处理。',coalesce(c.company_name,'未命名客户')),
  '/customers/'||f.customer_id,'followup',f.id,'followup-due:'||f.id,f.next_follow_date,'PENDING'
from (
  select distinct on(user_id,customer_id) id,user_id,customer_id,next_follow_date,created_at
  from public.followups order by user_id,customer_id,created_at desc
) f join public.customers c on c.id=f.customer_id
where f.next_follow_date is not null and f.next_follow_date>=now()-interval '30 days'
on conflict(recipient_id,dedupe_key) where dedupe_key is not null do nothing;

create or replace function public.current_user_is_warehouse()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.users where id=auth.uid() and role='WAREHOUSE' and status='ACTIVE') $$;

create or replace function public.create_quote_with_items(
  p_customer_id uuid,
  p_status text,
  p_currency text,
  p_valid_until date,
  p_payment_method text,
  p_delivery_date date,
  p_customer_short_name text,
  p_destination_country text,
  p_stocking_requirements text,
  p_shipping_cost numeric,
  p_notes text,
  p_items jsonb
) returns public.quotes language plpgsql security definer set search_path = public as $$
declare actor public.users; customer public.customers; created_quote public.quotes; quote_no text; subtotal_value numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role='WAREHOUSE' then raise exception '当前账号不能创建报价单'; end if;
  select * into customer from public.customers where id=p_customer_id and deleted_at is null for update;
  if customer.id is null then raise exception '客户不存在'; end if;
  if coalesce(customer.owner_user_id,customer.owner_id,customer.created_by) <> actor.id and actor.role<>'ADMIN' then raise exception '只能为归属自己的客户创建报价单'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '请至少添加一条产品明细'; end if;
  if p_status not in ('DRAFT','GENERATED','SENT') then raise exception '无效的报价状态'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit_price numeric,procurement_cost numeric)
    where nullif(trim(coalesce(item_name,'')),'') is null or coalesce(quantity,0)<=0 or coalesce(unit_price,-1)<0 or coalesce(procurement_cost,-1)<0)
  then raise exception '产品名称、数量、销售单价或采购成本不正确'; end if;
  select coalesce(sum(quantity*unit_price),0) into subtotal_value
  from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price numeric);
  quote_no := 'PI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.quotes(customer_id,created_by,owner_id,quote_number,currency,amount,status,valid_until,notes,
    subtotal,shipping_cost,total_amount,payment_method,delivery_date,customer_short_name,destination_country,stocking_requirements)
  values(customer.id,actor.id,case when actor.role='ADMIN' then coalesce(customer.owner_user_id,customer.owner_id,customer.created_by,actor.id) else actor.id end,quote_no,upper(coalesce(nullif(trim(p_currency),''),'USD')),
    subtotal_value+greatest(coalesce(p_shipping_cost,0),0),p_status,p_valid_until,nullif(trim(coalesce(p_notes,'')),''),
    subtotal_value,greatest(coalesce(p_shipping_cost,0),0),subtotal_value+greatest(coalesce(p_shipping_cost,0),0),
    nullif(trim(coalesce(p_payment_method,'')),''),p_delivery_date,
    coalesce(nullif(trim(coalesce(p_customer_short_name,'')),''),customer.company_name),
    coalesce(nullif(trim(coalesce(p_destination_country,'')),''),customer.country),nullif(trim(coalesce(p_stocking_requirements,'')),''))
  returning * into created_quote;
  insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,preparation_requirement)
  select created_quote.id,row_number() over(),trim(item_name),nullif(trim(coalesce(brand,'')),''),nullif(trim(coalesce(model,'')),''),
    nullif(trim(coalesce(quality,'')),''),coalesce(description,''),nullif(trim(coalesce(description_zh,'')),''),quantity,unit_price,procurement_cost,
    nullif(trim(coalesce(preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items) as x(item_name text,brand text,model text,quality text,description text,description_zh text,quantity numeric,unit_price numeric,procurement_cost numeric,preparation_requirement text);
  update public.customers set status='QUOTE',updated_at=now() where id=customer.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'QUOTE_CREATE','quote',created_quote.id,jsonb_build_object('quote_number',quote_no,'customer_id',customer.id,'status',p_status,'item_count',jsonb_array_length(p_items)));
  return created_quote;
end $$;

create or replace function public.update_quote_with_items(
  p_quote_id uuid,
  p_status text,
  p_currency text,
  p_valid_until date,
  p_payment_method text,
  p_delivery_date date,
  p_customer_short_name text,
  p_destination_country text,
  p_stocking_requirements text,
  p_shipping_cost numeric,
  p_notes text,
  p_items jsonb
) returns public.quotes language plpgsql security definer set search_path = public as $$
declare actor public.users; target public.quotes; updated_quote public.quotes; subtotal_value numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.quotes where id=p_quote_id for update;
  if actor.id is null or target.id is null then raise exception '账号或报价单不存在'; end if;
  if target.owner_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能修改归属自己的报价单'; end if;
  if target.status not in ('DRAFT','GENERATED','SENT') then raise exception '客户确认、过期或取消的报价不能修改'; end if;
  if p_status not in ('DRAFT','GENERATED','SENT') then raise exception '无效的报价状态'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '请至少添加一条产品明细'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit_price numeric,procurement_cost numeric)
    where nullif(trim(coalesce(item_name,'')),'') is null or coalesce(quantity,0)<=0 or coalesce(unit_price,-1)<0 or coalesce(procurement_cost,-1)<0)
  then raise exception '产品名称、数量、销售单价或采购成本不正确'; end if;
  select coalesce(sum(quantity*unit_price),0) into subtotal_value from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price numeric);
  update public.quotes set status=p_status,currency=upper(coalesce(nullif(trim(p_currency),''),'USD')),valid_until=p_valid_until,
    payment_method=nullif(trim(coalesce(p_payment_method,'')),''),delivery_date=p_delivery_date,
    customer_short_name=nullif(trim(coalesce(p_customer_short_name,'')),''),destination_country=nullif(trim(coalesce(p_destination_country,'')),''),
    stocking_requirements=nullif(trim(coalesce(p_stocking_requirements,'')),''),shipping_cost=greatest(coalesce(p_shipping_cost,0),0),
    subtotal=subtotal_value,total_amount=subtotal_value+greatest(coalesce(p_shipping_cost,0),0),amount=subtotal_value+greatest(coalesce(p_shipping_cost,0),0),
    notes=nullif(trim(coalesce(p_notes,'')),''),sent_at=case when p_status='SENT' then coalesce(sent_at,now()) else sent_at end,updated_at=now()
  where id=target.id returning * into updated_quote;
  delete from public.quote_items where quote_id=target.id;
  insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,preparation_requirement)
  select target.id,row_number() over(),trim(item_name),nullif(trim(coalesce(brand,'')),''),nullif(trim(coalesce(model,'')),''),
    nullif(trim(coalesce(quality,'')),''),coalesce(description,''),nullif(trim(coalesce(description_zh,'')),''),quantity,unit_price,procurement_cost,
    nullif(trim(coalesce(preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items) as x(item_name text,brand text,model text,quality text,description text,description_zh text,quantity numeric,unit_price numeric,procurement_cost numeric,preparation_requirement text);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'QUOTE_UPDATE','quote',target.id,jsonb_build_object('quote_number',target.quote_number,'status',p_status,'item_count',jsonb_array_length(p_items)));
  return updated_quote;
end $$;

create or replace function public.cancel_quote(p_quote_id uuid,p_reason text)
returns public.quotes language plpgsql security definer set search_path = public as $$
declare actor public.users; target public.quotes;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.quotes where id=p_quote_id for update;
  if actor.id is null or target.id is null then raise exception '账号或报价单不存在'; end if;
  if target.owner_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能取消归属自己的报价单'; end if;
  if target.status='CONFIRMED' then raise exception '客户已确认的报价不能直接取消，请在备货单中申请处理'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception '取消报价必须填写原因'; end if;
  update public.quotes set status='CANCELLED',cancellation_reason=trim(p_reason),cancelled_at=now(),updated_at=now() where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'QUOTE_CANCEL','quote',target.id,jsonb_build_object('quote_number',target.quote_number,'reason',trim(p_reason)));
  return target;
end $$;

create or replace function public.confirm_quote_and_create_stock_order(p_quote_id uuid)
returns public.stock_orders language plpgsql security definer set search_path = public as $$
declare
  actor public.users;
  target public.quotes;
  customer public.customers;
  created_order public.stock_orders;
  next_number text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号无效'; end if;
  select * into target from public.quotes where id=p_quote_id for update;
  if target.id is null then raise exception '报价单不存在'; end if;
  if target.owner_id <> actor.id and actor.role<>'ADMIN' then raise exception '只有报价归属销售员或系统管理员可以确认客户'; end if;
  if target.status='CANCELLED' then raise exception '已取消报价不能确认'; end if;
  if target.valid_until is not null and target.valid_until < current_date then
    raise exception '报价已超过有效期，请先更新报价有效期后再确认';
  end if;
  if target.status not in ('GENERATED','SENT') then raise exception '请先生成报价单再确认客户'; end if;
  if not exists(select 1 from public.quote_items where quote_id=target.id) then raise exception '报价单没有产品明细'; end if;
  select * into created_order from public.stock_orders where quote_id=target.id;
  if created_order.id is not null then return created_order; end if;
  select * into customer from public.customers where id=target.customer_id;
  next_number := 'BH-' || to_char(clock_timestamp(),'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  update public.quotes set status='CONFIRMED',customer_confirmed_at=now(),confirmed_by=actor.id,updated_at=now() where id=target.id;
  insert into public.stock_orders(quote_id,quote_number,stock_number,sales_user_id,customer_short_name,destination_country,stocking_requirements,updated_by)
  values(target.id,target.quote_number,next_number,target.owner_id,
    coalesce(nullif(target.customer_short_name,''),nullif(customer.company_name,''),'未命名客户'),
    coalesce(target.destination_country,customer.country),target.stocking_requirements,actor.id)
  returning * into created_order;
  insert into public.stock_order_items(stock_order_id,line_number,item_name,brand,model,quality,description,description_zh,procurement_cost,quantity,preparation_requirement)
  select created_order.id,line_number,item_name,brand,model,quality,description,description_zh,procurement_cost,quantity,preparation_requirement
  from public.quote_items where quote_id=target.id order by line_number;
  insert into public.stock_order_events(stock_order_id,to_status,note,created_by)
  values(created_order.id,'WAITING','客户已确认报价，系统自动生成备货单',actor.id);
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'STOCK_ORDER_CREATED','STOCK','收到新备货单',
    format('报价单 %s 已由 %s 确认，请安排备货。',target.quote_number,coalesce(actor.name,actor.email)),
    '/stock-orders/'||created_order.id,'stock_order',created_order.id,'stock-created:'||created_order.id,'PENDING'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'QUOTE_CONFIRM','quote',target.id,jsonb_build_object('quote_number',target.quote_number,'stock_order_id',created_order.id));
  return created_order;
end $$;

create or replace function public.update_stock_order_status(p_stock_order_id uuid,p_status text,p_note text default null)
returns public.stock_orders language plpgsql security definer set search_path = public as $$
declare actor public.users; target public.stock_orders; previous text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role not in ('WAREHOUSE','ADMIN') then raise exception '只有仓库员或系统管理员可以更新备货状态'; end if;
  if p_status not in ('WAITING','PREPARING','READY','SHORTAGE','CANCELLED') then raise exception '无效的备货状态'; end if;
  if p_status in ('SHORTAGE','CANCELLED') and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception '缺货异常或取消时必须填写原因说明';
  end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  previous:=target.status;
  if previous in ('READY','CANCELLED') and previous<>p_status then raise exception '已结束的备货单不能再变更状态'; end if;
  update public.stock_orders set status=p_status,status_note=nullif(trim(coalesce(p_note,'')),''),
    ready_at=case when p_status='READY' then now() else ready_at end,updated_by=actor.id,updated_at=now()
  where id=target.id returning * into target;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(target.id,previous,p_status,nullif(trim(coalesce(p_note,'')),''),actor.id);
  if p_status<>'WAITING' then
    update public.system_notifications set action_status='RESOLVED'
    where entity_type='stock_order' and entity_id=target.id and type='STOCK_ORDER_CREATED';
  end if;
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货状态已更新',
    format('备货单 %s 状态已更新为 %s%s。',target.stock_number,
      case p_status when 'WAITING' then '待备货' when 'PREPARING' then '备货中' when 'READY' then '已备齐' when 'SHORTAGE' then '缺货异常' else '已取消' end,
      case when nullif(trim(coalesce(p_note,'')),'') is null then '' else '：'||trim(p_note) end),
    '/stock-orders/'||target.id,'stock_order',target.id,'stock-status:'||target.id||':'||p_status||':'||extract(epoch from target.updated_at)::bigint,'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_STATUS_UPDATE','stock_order',target.id,jsonb_build_object('from',previous,'to',p_status,'note',p_note));
  return target;
end $$;

create or replace function public.stock_order_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare actor public.users; scope_id uuid; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号无效'; end if;
  if actor.role not in ('ADMIN','SUPERVISOR','SALES','WAREHOUSE') then raise exception '无权查看备货数据'; end if;
  scope_id:=case when actor.role in ('ADMIN','WAREHOUSE') then null else actor.id end;
  with scoped as (
    select s.* from public.stock_orders s where scope_id is null or s.sales_user_id=scope_id
  ), recent_rows as (
    select s.id,s.quote_id,s.quote_number,s.stock_number,s.sales_user_id,s.customer_short_name,s.destination_country,
      s.status,s.stocking_requirements,s.status_note,s.expected_ready_at,s.ready_at,s.created_at,s.updated_at,
      jsonb_build_object('name',u.name,'email',u.email) sales
    from scoped s left join public.users u on u.id=s.sales_user_id
    order by s.updated_at desc limit 10
  )
  select jsonb_build_object(
    'counts',jsonb_build_object(
      'WAITING',(select count(*) from scoped where status='WAITING'),
      'PREPARING',(select count(*) from scoped where status='PREPARING'),
      'SHORTAGE',(select count(*) from scoped where status='SHORTAGE'),
      'READY',(select count(*) from scoped where status='READY'),
      'CANCELLED',(select count(*) from scoped where status='CANCELLED')
    ),
    'recent',coalesce((select jsonb_agg(to_jsonb(recent_rows) order by updated_at desc) from recent_rows),'[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke execute on function public.confirm_quote_and_create_stock_order(uuid) from public,anon;
revoke execute on function public.update_stock_order_status(uuid,text,text) from public,anon;
revoke execute on function public.create_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb) from public,anon;
revoke execute on function public.update_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb) from public,anon;
revoke execute on function public.cancel_quote(uuid,text) from public,anon;
revoke execute on function public.stock_order_dashboard() from public,anon;
grant execute on function public.confirm_quote_and_create_stock_order(uuid) to authenticated;
grant execute on function public.update_stock_order_status(uuid,text,text) to authenticated;
grant execute on function public.create_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb) to authenticated;
grant execute on function public.update_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb) to authenticated;
grant execute on function public.cancel_quote(uuid,text) to authenticated;
grant execute on function public.stock_order_dashboard() to authenticated;

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.stock_orders enable row level security;
alter table public.stock_order_items enable row level security;
alter table public.stock_order_events enable row level security;
alter table public.api_cost_ledger enable row level security;
alter table public.cost_center_settings enable row level security;

drop policy if exists quotes_scope_select_v5 on public.quotes;
drop policy if exists quotes_own_insert_v5 on public.quotes;
drop policy if exists quotes_own_update_v5 on public.quotes;
drop policy if exists quotes_own_delete_v5 on public.quotes;
create policy quotes_scope_select_v5 on public.quotes for select to authenticated
  using (owner_id=auth.uid() or public.current_user_is_elevated());
create policy quotes_own_insert_v5 on public.quotes for insert to authenticated
  with check (created_by=auth.uid() and (owner_id=auth.uid() or public.current_user_is_admin()));
create policy quotes_own_update_v5 on public.quotes for update to authenticated
  using(owner_id=auth.uid() or public.current_user_is_admin()) with check(owner_id=auth.uid() or public.current_user_is_admin());
create policy quotes_own_delete_v5 on public.quotes for delete to authenticated
  using((owner_id=auth.uid() or public.current_user_is_admin()) and status in ('DRAFT','GENERATED'));

drop policy if exists quote_items_scope_select_v5 on public.quote_items;
drop policy if exists quote_items_own_write_v5 on public.quote_items;
create policy quote_items_scope_select_v5 on public.quote_items for select to authenticated
  using(exists(select 1 from public.quotes q where q.id=quote_id and (q.owner_id=auth.uid() or public.current_user_is_elevated())));
create policy quote_items_own_write_v5 on public.quote_items for all to authenticated
  using(exists(select 1 from public.quotes q where q.id=quote_id and (q.owner_id=auth.uid() or public.current_user_is_admin()) and q.status in ('DRAFT','GENERATED','SENT')))
  with check(exists(select 1 from public.quotes q where q.id=quote_id and (q.owner_id=auth.uid() or public.current_user_is_admin()) and q.status in ('DRAFT','GENERATED','SENT')));

drop policy if exists stock_orders_scope_select_v5 on public.stock_orders;
create policy stock_orders_scope_select_v5 on public.stock_orders for select to authenticated
  using(sales_user_id=auth.uid() or public.current_user_is_elevated() or public.current_user_is_warehouse());
drop policy if exists stock_items_scope_select_v5 on public.stock_order_items;
create policy stock_items_scope_select_v5 on public.stock_order_items for select to authenticated
  using(exists(select 1 from public.stock_orders s where s.id=stock_order_id and (s.sales_user_id=auth.uid() or public.current_user_is_elevated() or public.current_user_is_warehouse())));
drop policy if exists stock_events_scope_select_v5 on public.stock_order_events;
create policy stock_events_scope_select_v5 on public.stock_order_events for select to authenticated
  using(exists(select 1 from public.stock_orders s where s.id=stock_order_id and (s.sales_user_id=auth.uid() or public.current_user_is_elevated() or public.current_user_is_warehouse())));

drop policy if exists api_cost_admin_select_v5 on public.api_cost_ledger;
create policy api_cost_admin_select_v5 on public.api_cost_ledger for select to authenticated using(public.current_user_is_admin());
drop policy if exists cost_settings_admin_all_v5 on public.cost_center_settings;
create policy cost_settings_admin_all_v5 on public.cost_center_settings for all to authenticated
  using(public.current_user_is_admin()) with check(public.current_user_is_admin());

-- The supervisor's cross-user permissions are read-only. Keep the database
-- write boundary aligned with the API: owners can write their own business
-- records, while only the system administrator has a global maintenance
-- override. This replaces older elevated-role write policies.
drop policy if exists customers_own_insert_v4 on public.customers;
drop policy if exists customers_own_update_v4 on public.customers;
drop policy if exists customers_own_delete_v4 on public.customers;
create policy customers_owner_or_admin_insert_v5 on public.customers for insert to authenticated
  with check (
    public.current_user_is_admin()
    or (
      created_by=auth.uid()
      and coalesce(owner_user_id,owner_id,created_by)=auth.uid()
      and (owner_user_id is null or owner_user_id=auth.uid())
      and (owner_id is null or owner_id=auth.uid())
    )
  );
create policy customers_owner_or_admin_update_v5 on public.customers for update to authenticated
  using(public.current_user_is_admin() or coalesce(owner_user_id,owner_id,created_by)=auth.uid())
  with check(public.current_user_is_admin() or coalesce(owner_user_id,owner_id,created_by)=auth.uid());
create policy customers_owner_or_admin_delete_v5 on public.customers for delete to authenticated
  using(public.current_user_is_admin() or coalesce(owner_user_id,owner_id,created_by)=auth.uid());

drop policy if exists protection_own_write_v4 on public.customer_protection;
create policy protection_owner_or_admin_write_v5 on public.customer_protection for all to authenticated
  using(public.current_user_is_admin() or owner_id=auth.uid())
  with check(public.current_user_is_admin() or owner_id=auth.uid());

drop policy if exists followups_own_insert_v4 on public.followups;
drop policy if exists followups_own_update_v4 on public.followups;
create policy followups_owner_or_admin_insert_v5 on public.followups for insert to authenticated
  with check (
    user_id=auth.uid()
    and exists(
      select 1 from public.customers customer
      where customer.id=customer_id
        and (public.current_user_is_admin() or coalesce(customer.owner_user_id,customer.owner_id,customer.created_by)=auth.uid())
    )
  );
create policy followups_owner_or_admin_update_v5 on public.followups for update to authenticated
  using(public.current_user_is_admin() or user_id=auth.uid())
  with check(public.current_user_is_admin() or user_id=auth.uid());

drop policy if exists import_tasks_own_update_v4 on public.import_tasks;
create policy import_tasks_owner_or_admin_update_v5 on public.import_tasks for update to authenticated
  using(public.current_user_is_admin() or created_by=auth.uid())
  with check(public.current_user_is_admin() or created_by=auth.uid());

drop policy if exists ai_tasks_own_insert_v4 on public.ai_screening_tasks;
drop policy if exists ai_tasks_own_update_v4 on public.ai_screening_tasks;
drop policy if exists ai_tasks_own_delete_v4 on public.ai_screening_tasks;
create policy ai_tasks_owner_or_admin_insert_v5 on public.ai_screening_tasks for insert to authenticated
  with check(public.current_user_is_admin() or user_id=auth.uid());
create policy ai_tasks_owner_or_admin_update_v5 on public.ai_screening_tasks for update to authenticated
  using(public.current_user_is_admin() or user_id=auth.uid())
  with check(public.current_user_is_admin() or user_id=auth.uid());
create policy ai_tasks_owner_or_admin_delete_v5 on public.ai_screening_tasks for delete to authenticated
  using(public.current_user_is_admin() or user_id=auth.uid());

drop policy if exists customer_conflicts_update_v4 on public.customer_conflicts;
create policy customer_conflicts_reporter_or_admin_update_v5 on public.customer_conflicts for update to authenticated
  using(public.current_user_is_admin() or reported_by=auth.uid())
  with check(public.current_user_is_admin() or reported_by=auth.uid());

grant select,insert,update,delete on public.quotes,public.quote_items to authenticated;
grant select on public.stock_orders,public.stock_order_items,public.stock_order_events to authenticated;
grant select on public.api_cost_ledger to authenticated;
grant select,update on public.cost_center_settings to authenticated;

insert into public.role_permission_settings(role_code,permission_code,enabled)
select role_code,permission_code,true from (values
  ('SUPERVISOR','quotes.view'),('SUPERVISOR','quotes.data_all'),('SUPERVISOR','quotes.create'),('SUPERVISOR','quotes.edit'),('SUPERVISOR','quotes.confirm'),('SUPERVISOR','quotes.export'),('SUPERVISOR','quotes.cancel'),
  ('SUPERVISOR','stock.view'),('SUPERVISOR','stock.data_all'),('SUPERVISOR','stock.export'),('SUPERVISOR','followups.edit'),('SUPERVISOR','followups.export'),('SUPERVISOR','notifications.view'),
  ('SALES','quotes.view'),('SALES','quotes.create'),('SALES','quotes.edit'),('SALES','quotes.confirm'),('SALES','quotes.export'),('SALES','quotes.cancel'),
  ('SALES','stock.view'),('SALES','stock.export'),('SALES','followups.edit'),('SALES','followups.export'),('SALES','notifications.view'),
  ('WAREHOUSE','dashboard.view'),('WAREHOUSE','stock.view'),('WAREHOUSE','stock.update'),('WAREHOUSE','stock.export'),('WAREHOUSE','notifications.view'),('WAREHOUSE','system.security.view')
) as seed(role_code,permission_code)
on conflict(role_code,permission_code) do update set enabled=excluded.enabled;

insert into public.role_permission_settings(role_code,permission_code,enabled)
select 'ADMIN',permission_code,true from (values
  ('quotes.view'),('quotes.data_all'),('quotes.create'),('quotes.edit'),('quotes.confirm'),('quotes.export'),('quotes.cancel'),
  ('stock.view'),('stock.data_all'),('stock.export'),('followups.edit'),('followups.export'),('notifications.view'),('costs.view'),('costs.export')
) as seed(permission_code)
on conflict(role_code,permission_code) do update set enabled=true;

-- Report center uses database-side aggregates and real business records.  It
-- never downloads the whole customer table and never returns placeholder data.
create or replace function public.sales_performance_report(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid,name text,email text,new_customers bigint,claimed bigint,released bigint,followups bigint,quotes bigint,deals bigint,ai_valid bigint,customer_count bigint,conversion_rate numeric)
language sql stable security definer set search_path = public as $$
  with actor as (select id,role from public.users where id=auth.uid() and status='ACTIVE'),
  sales as (
    select u.id,coalesce(nullif(u.name,''),u.email) as name,u.email from public.users u cross join actor a
    where u.status='ACTIVE' and u.role in ('SALES','SUPERVISOR') and ((a.role in ('ADMIN','SUPERVISOR')) or u.id=a.id)
  ), customer_stats as (
    select s.id,
      count(c.id) filter(where c.created_by=s.id and c.created_at>=p_from and c.created_at<p_to) as new_customers,
      count(c.id) filter(where coalesce(c.owner_user_id,c.owner_id,c.created_by)=s.id and c.ai_score>=60 and c.deleted_at is null) as ai_valid,
      count(c.id) filter(where coalesce(c.owner_user_id,c.owner_id,c.created_by)=s.id and c.deleted_at is null) as customer_count
    from sales s left join public.customers c on c.created_by=s.id or coalesce(c.owner_user_id,c.owner_id,c.created_by)=s.id group by s.id
  ), claim_stats as (
    select s.id,count(cc.id) filter(where cc.action in ('CLAIM','TRANSFER')) as claimed,count(cc.id) filter(where cc.action='RELEASE') as released
    from sales s left join public.customer_claims cc on cc.user_id=s.id and cc.created_at>=p_from and cc.created_at<p_to group by s.id
  ), followup_stats as (
    select s.id,count(f.id) as followups from sales s left join public.followups f on f.user_id=s.id and f.created_at>=p_from and f.created_at<p_to group by s.id
  ), quote_stats as (
    select s.id,count(q.id) as quotes from sales s left join public.quotes q on q.owner_id=s.id and q.created_at>=p_from and q.created_at<p_to group by s.id
  ), deal_stats as (
    select s.id,count(a.id) filter(where a.content->>'status'='DEAL') as deals
    from sales s left join public.audit_logs a on a.user_id=s.id and a.action='CUSTOMER_STAGE' and a.created_at>=p_from and a.created_at<p_to group by s.id
  )
  select s.id,s.name,s.email,cs.new_customers,cl.claimed,cl.released,fs.followups,qs.quotes,ds.deals,cs.ai_valid,cs.customer_count,
    coalesce(round(ds.deals::numeric*100/nullif(cs.customer_count,0),1),0)
  from sales s join customer_stats cs on cs.id=s.id join claim_stats cl on cl.id=s.id join followup_stats fs on fs.id=s.id
  join quote_stats qs on qs.id=s.id join deal_stats ds on ds.id=s.id
  order by ds.deals desc,coalesce(round(ds.deals::numeric*100/nullif(cs.customer_count,0),1),0) desc,fs.followups desc
$$;

create or replace function public.sales_report_breakdowns(p_from timestamptz,p_to timestamptz,p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.users; scope_id uuid; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role='WAREHOUSE' then raise exception '无权查看销售报表'; end if;
  scope_id:=case when actor.role in ('ADMIN','SUPERVISOR') then p_user_id else actor.id end;
  with scoped_customers as (
    select c.* from public.customers c where c.deleted_at is null and (scope_id is null or coalesce(c.owner_user_id,c.owner_id,c.created_by)=scope_id)
  ), ai_rows as (
    select coalesce(nullif(ai_level,''),'未筛选') label,count(*) count from scoped_customers group by 1 order by 2 desc
  ), country_rows as (
    select coalesce(nullif(trim(country),''),'未知') label,count(*) count from scoped_customers group by 1 order by 2 desc limit 10
  ), stage_rows as (
    select status label,count(*) count from scoped_customers group by 1 order by 2 desc
  ), followup_rows as (
    select coalesce(nullif(type,''),'其他') label,count(*) count from public.followups
    where created_at>=p_from and created_at<p_to and (scope_id is null or user_id=scope_id) group by 1 order by 2 desc
  ), quote_rows as (
    select status label,count(*) count,coalesce(sum(total_amount),0) amount from public.quotes
    where created_at>=p_from and created_at<p_to and (scope_id is null or owner_id=scope_id) group by 1 order by 2 desc
  ), stock_rows as (
    select status label,count(*) count from public.stock_orders
    where created_at>=p_from and created_at<p_to and (scope_id is null or sales_user_id=scope_id) group by 1 order by 2 desc
  ), days as (
    select generate_series(date_trunc('day',p_from),date_trunc('day',p_to-interval '1 millisecond'),interval '1 day') as day_value
  ), trend_rows as (
    select to_char(d.day_value,'YYYY-MM-DD') date,
      (select count(*) from scoped_customers c where c.created_at>=d.day_value and c.created_at<d.day_value+interval '1 day') customers,
      (select count(*) from public.followups f where f.created_at>=d.day_value and f.created_at<d.day_value+interval '1 day' and (scope_id is null or f.user_id=scope_id)) followups,
      (select count(*) from public.quotes q where q.created_at>=d.day_value and q.created_at<d.day_value+interval '1 day' and (scope_id is null or q.owner_id=scope_id)) quotes
    from days d order by d.day_value
  )
  select jsonb_build_object(
    'ai_levels',coalesce((select jsonb_agg(ai_rows) from ai_rows),'[]'::jsonb),
    'countries',coalesce((select jsonb_agg(country_rows) from country_rows),'[]'::jsonb),
    'customer_stages',coalesce((select jsonb_agg(stage_rows) from stage_rows),'[]'::jsonb),
    'followup_types',coalesce((select jsonb_agg(followup_rows) from followup_rows),'[]'::jsonb),
    'quote_statuses',coalesce((select jsonb_agg(quote_rows) from quote_rows),'[]'::jsonb),
    'stock_statuses',coalesce((select jsonb_agg(stock_rows) from stock_rows),'[]'::jsonb),
    'trend',coalesce((select jsonb_agg(trend_rows) from trend_rows),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke execute on function public.sales_report_breakdowns(timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.sales_performance_report(timestamptz,timestamptz), public.sales_report_breakdowns(timestamptz,timestamptz,uuid) to authenticated;

-- Ownership-changing customer flows follow the same final role contract:
-- supervisors can act on their own customers only; administrators can perform
-- system-wide maintenance and the audit trail records the actual actor.
create or replace function public.release_customer(p_customer_id uuid,p_reason text)
returns public.customers language plpgsql security definer set search_path=public as $$
declare target public.customers; actor public.users; previous_owner uuid; last_claim timestamptz;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is distinct from actor.id and actor.role<>'ADMIN' then raise exception '只能释放归属自己的客户'; end if;
  if nullif(trim(p_reason),'') is null then raise exception '请填写释放原因'; end if;
  previous_owner:=target.owner_id;
  select created_at into last_claim from public.customer_claims where customer_id=target.id and action in ('CLAIM','TRANSFER') order by created_at desc limit 1;
  update public.customer_protection set status='RELEASED' where customer_id=target.id and owner_id=previous_owner and status='ACTIVE';
  update public.customers set owner_id=null,owner_user_id=null,status='RELEASED' where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason)
  values(target.id,actor.id,'RELEASE',case when actor.role='ADMIN' then 'ADMIN_ASSIGN' else 'SELF_CLAIM' end,actor.name,last_claim,now(),trim(p_reason));
  return target;
end $$;

create or replace function public.assign_customer(p_customer_id uuid,p_user_id uuid)
returns public.customers language plpgsql security definer set search_path=public as $$
declare target public.customers; actor public.users; assignee public.users; operation text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role not in ('ADMIN','SUPERVISOR') then raise exception '仅主管或系统管理员可分配客户'; end if;
  select * into assignee from public.users where id=p_user_id and status='ACTIVE' and role in ('SALES','SUPERVISOR');
  if assignee.id is null then raise exception '目标销售员不存在或未启用'; end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.owner_id is not null and target.owner_id<>actor.id and actor.role<>'ADMIN' then raise exception '其他销售员的客户仅供查看，不能重新分配'; end if;
  operation:=case when target.owner_id is null then 'CLAIM' else 'TRANSFER' end;
  update public.customer_protection set status='SUPERSEDED' where customer_id=target.id and status='ACTIVE';
  update public.customers set owner_id=assignee.id,owner_user_id=assignee.id,department_id=null,status='CLAIMED',updated_at=now() where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at)
  values(target.id,assignee.id,operation,'ADMIN_ASSIGN',assignee.name,now());
  return target;
end $$;

create or replace function public.set_customer_stage(p_customer_id uuid,p_status text)
returns public.customers language plpgsql security definer set search_path=public as $$
declare target public.customers; actor public.users; record_owner uuid; protection_type text; protection_expire timestamptz;
begin
  if p_status not in ('CLAIMED','FOLLOWING','QUOTE','DEAL') then raise exception '无效客户阶段'; end if;
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  record_owner:=coalesce(target.owner_id,actor.id);
  if record_owner<>actor.id and actor.role<>'ADMIN' then raise exception '只能修改归属自己的客户阶段'; end if;
  if target.status=p_status then
    update public.customers set status=p_status,updated_at=now() where id=target.id returning * into target;
    return target;
  end if;
  update public.customer_protection set status='SUPERSEDED' where customer_id=target.id and owner_id=record_owner and status='ACTIVE';
  if p_status in ('FOLLOWING','QUOTE','DEAL') then
    protection_type:=case p_status when 'FOLLOWING' then 'INTENT' when 'QUOTE' then 'QUOTE' else 'DEAL' end;
    protection_expire:=case p_status when 'FOLLOWING' then now()+interval '90 days' when 'QUOTE' then now()+interval '180 days' else null end;
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
    values(target.id,record_owner,protection_type,now(),protection_expire,'ACTIVE',0);
  end if;
  update public.customers set status=p_status,updated_at=now() where id=target.id returning * into target;
  return target;
end $$;

create or replace function public.renew_customer_protection(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.customers; record_owner uuid; protection public.customer_protection; effective_expire timestamptz; next_expire timestamptz; next_count integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前用户无效'; end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  record_owner:=coalesce(target.owner_id,actor.id);
  if record_owner<>actor.id and actor.role<>'ADMIN' then raise exception '客户已不归属当前用户，不能续期'; end if;
  if target.status='DEAL' then raise exception '已成交客户为永久保护，无需续期'; end if;
  select * into protection from public.customer_protection where customer_id=target.id and owner_id=record_owner order by start_date desc limit 1 for update;
  if protection.id is not null and protection.status='RELEASED' then raise exception '客户已主动释放，不能续期'; end if;
  effective_expire:=coalesce(protection.expire_date,target.created_at+interval '90 days');
  if effective_expire is null then raise exception '当前客户为永久保护，无需续期'; end if;
  if now()<effective_expire then raise exception '保护期尚未到期，无需续期'; end if;
  if now()>effective_expire+interval '7 days' then raise exception '续期宽限期已结束'; end if;
  next_count:=coalesce(protection.extension_count,0)+1;
  if next_count>2 then raise exception '同一保护周期最多续期2次'; end if;
  next_expire:=greatest(effective_expire,now())+interval '45 days';
  if protection.id is null then
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count,last_extended_at)
    values(target.id,record_owner,case when target.status='QUOTE' then 'QUOTE' else 'INTENT' end,target.created_at,next_expire,'ACTIVE',next_count,now()) returning * into protection;
  else
    update public.customer_protection set expire_date=next_expire,status='ACTIVE',extension_count=next_count,last_extended_at=now() where id=protection.id returning * into protection;
  end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_PROTECTION_RENEW','customer',target.id,jsonb_build_object('owner_id',record_owner,'days',45,'extension_count',next_count,'expire_date',next_expire));
  return jsonb_build_object('customer_id',target.id,'expire_date',next_expire,'extension_count',next_count);
end $$;

revoke execute on function public.release_customer(uuid,text),public.assign_customer(uuid,uuid),public.set_customer_stage(uuid,text),public.renew_customer_protection(uuid) from public,anon;
grant execute on function public.release_customer(uuid,text),public.assign_customer(uuid,uuid),public.set_customer_stage(uuid,text),public.renew_customer_protection(uuid) to authenticated;
