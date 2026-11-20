begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- New expenses are append-only, separate from historical shipment charges.
-- A linked packaging charge is payable to the supplier on that exact note;
-- shipping advances and other costs never become supplier payable.
create table public.stock_order_expense_entries (
  id uuid primary key default gen_random_uuid(),
  stock_order_id uuid not null references public.stock_orders(id) on delete restrict,
  expense_type text not null check (expense_type in ('PACKAGING','SHIPPING','OTHER')),
  amount_cny numeric(16,2) not null check (amount_cny > 0),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  delivery_note_id uuid references public.supplier_delivery_notes(id) on delete restrict,
  expense_item text,
  description text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint stock_expense_fields_check check (
    (expense_type='PACKAGING' and supplier_id is not null and delivery_note_id is not null)
    or (expense_type='SHIPPING' and supplier_id is null and delivery_note_id is null)
    or (expense_type='OTHER' and supplier_id is null and delivery_note_id is null
      and char_length(btrim(coalesce(expense_item,''))) between 2 and 100
      and char_length(btrim(coalesce(description,''))) between 2 and 500)
  )
);
create index stock_expense_entries_order_idx on public.stock_order_expense_entries(stock_order_id,created_at);
create index stock_expense_entries_note_idx on public.stock_order_expense_entries(delivery_note_id)
  where delivery_note_id is not null;
create index stock_expense_entries_supplier_idx on public.stock_order_expense_entries(supplier_id,created_at)
  where supplier_id is not null;
alter table public.stock_order_expense_entries enable row level security;
revoke all on public.stock_order_expense_entries from public,anon,authenticated;

create function public.record_stock_order_expense(
  p_stock_order_id uuid, p_expense_type text, p_amount_cny numeric,
  p_supplier_id uuid default null, p_delivery_note_id uuid default null,
  p_expense_item text default null, p_description text default null
) returns public.stock_order_expense_entries
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  note public.supplier_delivery_notes;
  result public.stock_order_expense_entries;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库费用登记权限';
  end if;
  if p_expense_type not in ('PACKAGING','SHIPPING','OTHER')
    or p_amount_cny is null or p_amount_cny <= 0 or p_amount_cny > 999999999999.99
    or p_amount_cny <> round(p_amount_cny,2) then
    raise exception '请选择费用类型并填写大于零的人民币金额（最多两位小数）';
  end if;
  if char_length(coalesce(p_expense_item,'')) > 100
    or char_length(coalesce(p_description,'')) > 500 then
    raise exception '费用项目最多100字，说明最多500字';
  end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null or target.archived_at is not null
    or target.status in ('DRAFT','CANCELLED')
    or (not public.current_user_has_business_permission('stock.data_all')
      and target.sales_user_id is distinct from actor.id) then
    raise exception '备货单不存在或当前不可登记费用';
  end if;
  if p_expense_type='PACKAGING' then
    if p_supplier_id is null or not exists(select 1 from public.suppliers s
      where s.id=p_supplier_id and s.is_active) then
      raise exception '包装费用须关联启用的供应商代码';
    end if;
    if p_delivery_note_id is null then raise exception '包装费用须关联真实送货单'; end if;
    select * into note from public.supplier_delivery_notes where id=p_delivery_note_id for update;
    if note.id is null or note.number_pending or note.supplier_id<>p_supplier_id or not exists (
      select 1 from public.supplier_receipt_allocations a
      join public.stock_order_items i on i.id=a.stock_order_item_id
      where a.delivery_note_id=note.id and i.stock_order_id=target.id and a.quantity>0
    ) then raise exception '请选择本备货单真实关联的供应商送货单'; end if;
  elsif p_expense_type='SHIPPING' then
    if p_supplier_id is not null or p_delivery_note_id is not null then
      raise exception '出货费用不计入供应商送货单应付'; end if;
  else
    if p_supplier_id is not null or p_delivery_note_id is not null
      or char_length(btrim(coalesce(p_expense_item,''))) not between 2 and 100
      or char_length(btrim(coalesce(p_description,''))) not between 2 and 500 then
      raise exception '其他费用必须填写2至100字费用项目及2至500字说明';
    end if;
  end if;
  insert into public.stock_order_expense_entries(stock_order_id,expense_type,amount_cny,
    supplier_id,delivery_note_id,expense_item,description,created_by)
  values(target.id,p_expense_type,p_amount_cny,p_supplier_id,p_delivery_note_id,
    nullif(btrim(coalesce(p_expense_item,'')),''),nullif(btrim(coalesce(p_description,'')),''),actor.id)
  returning * into result;
  insert into public.stock_order_expenses(stock_order_id,packaging_cost_cny,
    shipping_expenses_cny,procurement_expenses_cny,updated_by)
  values(target.id,case when p_expense_type='PACKAGING' then p_amount_cny else 0 end,
    case when p_expense_type='SHIPPING' then p_amount_cny else 0 end,
    case when p_expense_type='OTHER' then p_amount_cny else 0 end,actor.id)
  on conflict(stock_order_id) do update set
    packaging_cost_cny=public.stock_order_expenses.packaging_cost_cny+excluded.packaging_cost_cny,
    shipping_expenses_cny=public.stock_order_expenses.shipping_expenses_cny+excluded.shipping_expenses_cny,
    procurement_expenses_cny=public.stock_order_expenses.procurement_expenses_cny+excluded.procurement_expenses_cny,
    updated_by=excluded.updated_by,updated_at=now();
  if note.id is not null then
    update public.supplier_delivery_notes set updated_at=now() where id=note.id;
  end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_ORDER_EXPENSE_RECORDED','stock_order',target.id,
    jsonb_build_object('entry_id',result.id,'type',p_expense_type,'amount_cny',p_amount_cny,
      'supplier_id',p_supplier_id,'delivery_note_id',p_delivery_note_id,
      'expense_item',result.expense_item,'description',result.description));
  return result;
end;
$$;
revoke all on function public.record_stock_order_expense(uuid,text,numeric,uuid,uuid,text,text)
  from public,anon,authenticated;

create table public.stock_order_expense_batches (
  request_id uuid primary key,
  stock_order_id uuid not null references public.stock_orders(id) on delete restrict,
  payload jsonb not null,
  result jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.stock_order_expense_batches enable row level security;
revoke all on public.stock_order_expense_batches from public,anon,authenticated;

create function public.record_stock_order_expenses_batch(p_stock_order_id uuid,p_entries jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; saved public.stock_order_expense_entries; results jsonb := '[]'::jsonb;
  prior public.stock_order_expense_batches; actor public.users;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库费用登记权限'; end if;
  if p_entries is null or jsonb_typeof(p_entries)<>'array'
    or jsonb_array_length(p_entries) not between 1 and 20 or p_request_id is null then
    raise exception '每次可登记1至20项费用'; end if;
  insert into public.stock_order_expense_batches(request_id,stock_order_id,payload,created_by)
  values(p_request_id,p_stock_order_id,p_entries,actor.id)
  on conflict(request_id) do nothing;
  if not found then
    select * into prior from public.stock_order_expense_batches where request_id=p_request_id;
    if prior.created_by<>actor.id or prior.stock_order_id<>p_stock_order_id or prior.payload<>p_entries then
      raise exception '费用提交编号重复且内容不一致'; end if;
    return prior.result;
  end if;
  for row_data in select value from jsonb_array_elements(p_entries) loop
    saved := public.record_stock_order_expense(p_stock_order_id,row_data->>'expense_type',
      (row_data->>'amount_cny')::numeric,nullif(row_data->>'supplier_id','')::uuid,
      nullif(row_data->>'delivery_note_id','')::uuid,row_data->>'expense_item',
      row_data->>'description');
    results := results || to_jsonb(saved);
  end loop;
  update public.stock_order_expense_batches set result=results where request_id=p_request_id;
  return results;
end;
$$;
revoke all on function public.record_stock_order_expenses_batch(uuid,jsonb,uuid) from public,anon;
grant execute on function public.record_stock_order_expenses_batch(uuid,jsonb,uuid) to authenticated;

create function public.stock_order_expense_entries_for_detail(p_stock_order_id uuid)
returns setof public.stock_order_expense_entries
language plpgsql security definer set search_path = '' as $$
declare actor public.users;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role in ('SALES','ORDER_CLERK')
    or not public.current_user_has_business_permission('stock.view')
    or not public.current_user_has_business_permission('stock.update')
    or not exists(select 1 from public.stock_orders s where s.id=p_stock_order_id
      and (public.current_user_has_business_permission('stock.data_all') or s.sales_user_id=actor.id))
  then raise exception '无仓库费用查看权限'; end if;
  return query select * from public.stock_order_expense_entries e
    where e.stock_order_id=p_stock_order_id order by e.created_at desc,e.id desc;
end;
$$;
revoke all on function public.stock_order_expense_entries_for_detail(uuid) from public,anon;
grant execute on function public.stock_order_expense_entries_for_detail(uuid) to authenticated;

-- Historical handoff charges had no supplier attribution. Corrections are
-- append-only: only an explicitly verified packaging correction may become
-- supplier payable; old unverified values stay out of the supplier ledger.
create table public.stock_order_shipment_expense_corrections (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.stock_order_shipments(id) on delete restrict,
  stock_order_id uuid not null references public.stock_orders(id) on delete restrict,
  expense_type text not null check (expense_type in ('PACKAGING','SHIPPING','OTHER')),
  previous_cny numeric(14,2) not null check (previous_cny >= 0),
  revised_cny numeric(14,2) not null check (revised_cny >= 0),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  delivery_note_id uuid references public.supplier_delivery_notes(id) on delete restrict,
  expense_item text,
  description text,
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint shipment_expense_correction_fields check (
    (expense_type='PACKAGING' and
      ((revised_cny=0 and supplier_id is null and delivery_note_id is null)
        or (revised_cny>0 and supplier_id is not null and delivery_note_id is not null)))
    or (expense_type='SHIPPING' and supplier_id is null and delivery_note_id is null)
    or (expense_type='OTHER' and supplier_id is null and delivery_note_id is null
      and (revised_cny=0 or (char_length(btrim(coalesce(expense_item,''))) between 2 and 100
        and char_length(btrim(coalesce(description,''))) between 2 and 500)))
  )
);
create index stock_shipment_expense_corrections_latest_idx on
  public.stock_order_shipment_expense_corrections(shipment_id,expense_type,created_at desc,id desc);
create index stock_shipment_expense_corrections_note_idx on
  public.stock_order_shipment_expense_corrections(delivery_note_id)
  where delivery_note_id is not null;
alter table public.stock_order_shipment_expense_corrections enable row level security;
revoke all on public.stock_order_shipment_expense_corrections from public,anon,authenticated;

create table public.stock_order_expense_entry_corrections (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.stock_order_expense_entries(id) on delete restrict,
  stock_order_id uuid not null references public.stock_orders(id) on delete restrict,
  previous_cny numeric(16,2) not null check(previous_cny>=0),
  revised_cny numeric(16,2) not null check(revised_cny>=0),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  delivery_note_id uuid references public.supplier_delivery_notes(id) on delete restrict,
  expense_item text,
  description text,
  reason text not null check(char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index stock_expense_entry_corrections_latest_idx on
  public.stock_order_expense_entry_corrections(entry_id,created_at desc,id desc);
create index stock_expense_entry_corrections_note_idx on
  public.stock_order_expense_entry_corrections(delivery_note_id)
  where delivery_note_id is not null;
alter table public.stock_order_expense_entry_corrections enable row level security;
revoke all on public.stock_order_expense_entry_corrections from public,anon,authenticated;

create function public.supplier_note_packaging_cny(p_delivery_note_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(coalesce(c.revised_cny,e.amount_cny))
      from public.stock_order_expense_entries e
      left join lateral (select revised_cny,delivery_note_id
        from public.stock_order_expense_entry_corrections ec where ec.entry_id=e.id
        order by ec.created_at desc,ec.id desc limit 1) c on true
      where coalesce(c.delivery_note_id,e.delivery_note_id)=p_delivery_note_id
        and e.expense_type='PACKAGING'),0)
    + coalesce((select sum(c.revised_cny)
      from public.stock_order_shipment_expense_corrections c
      where c.delivery_note_id=p_delivery_note_id and c.expense_type='PACKAGING'
        and not exists(select 1 from public.stock_order_shipment_expense_corrections newer
          where newer.shipment_id=c.shipment_id and newer.expense_type='PACKAGING'
            and (newer.created_at,newer.id)>(c.created_at,c.id))),0);
$$;
revoke all on function public.supplier_note_packaging_cny(uuid) from public,anon,authenticated;

create function public.correct_stock_order_shipment_expense(
  p_stock_order_id uuid,p_shipment_id uuid,p_expense_type text,p_expected_cny numeric,p_revised_cny numeric,
  p_supplier_id uuid,p_delivery_note_id uuid,p_expense_item text,
  p_description text,p_reason text
) returns public.stock_order_shipment_expense_corrections
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  shipment public.stock_order_shipments;
  target public.stock_orders;
  prior public.stock_order_shipment_expense_corrections;
  original_cny numeric;
  current_cny numeric;
  note public.supplier_delivery_notes;
  due_cny numeric;
  paid_cny numeric;
  result public.stock_order_shipment_expense_corrections;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无历史费用更正权限'; end if;
  if p_expense_type not in ('PACKAGING','SHIPPING','OTHER')
    or p_expected_cny is null or p_revised_cny is null or p_revised_cny<0
    or p_revised_cny>999999999999.99 or p_revised_cny<>round(p_revised_cny,2)
    or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then
    raise exception '请填写有效的更正金额和原因'; end if;
  select * into shipment from public.stock_order_shipments where id=p_shipment_id for update;
  if shipment.id is null or shipment.stock_order_id<>p_stock_order_id then
    raise exception '备货单与交货记录不匹配'; end if;
  select * into target from public.stock_orders where id=shipment.stock_order_id for update;
  if target.id is null or target.archived_at is not null
    or target.status in ('DRAFT','CANCELLED')
    or (not public.current_user_has_business_permission('stock.data_all')
      and target.sales_user_id is distinct from actor.id) then
    raise exception '备货单不存在或不可更正'; end if;
  original_cny := case p_expense_type when 'PACKAGING' then shipment.packaging_cost_cny
    when 'SHIPPING' then shipment.shipping_expenses_cny else shipment.procurement_expenses_cny end;
  select * into prior from public.stock_order_shipment_expense_corrections
    where shipment_id=shipment.id and expense_type=p_expense_type
    order by created_at desc,id desc limit 1;
  current_cny := coalesce(prior.revised_cny,original_cny);
  if p_expected_cny<>current_cny then raise exception '费用已被他人更正，请刷新后重试'; end if;
  if p_expense_type='PACKAGING' and p_revised_cny>0 then
    if p_supplier_id is null or p_delivery_note_id is null then
      raise exception '包装费须关联供应商及真实送货单'; end if;
    select * into note from public.supplier_delivery_notes
      where id=p_delivery_note_id for update;
    if note.id is null or note.number_pending or note.supplier_id<>p_supplier_id or not exists(
      select 1 from public.supplier_receipt_allocations a
      join public.stock_order_items i on i.id=a.stock_order_item_id
      where a.delivery_note_id=note.id and i.stock_order_id=target.id and a.quantity>0
    ) then raise exception '包装费送货单与备货单或供应商不匹配'; end if;
  elsif p_supplier_id is not null or p_delivery_note_id is not null then
    raise exception '此费用类型不得关联供应商送货单';
  end if;
  if p_expense_type='OTHER' and p_revised_cny>0 and
    (char_length(btrim(coalesce(p_expense_item,''))) not between 2 and 100
      or char_length(btrim(coalesce(p_description,''))) not between 2 and 500) then
    raise exception '其他费用更正须填写项目和说明'; end if;
  -- Do not let a changed payable fall below already recorded supplier payment.
  if p_expense_type='PACKAGING' and prior.delivery_note_id is not null then
    select coalesce(sum(amount_cny),0) into due_cny from public.supplier_receipt_allocations
      where delivery_note_id=prior.delivery_note_id;
    select coalesce(sum(amount_cny),0) into paid_cny from public.supplier_payments
      where delivery_note_id=prior.delivery_note_id;
    if paid_cny>due_cny + public.supplier_note_packaging_cny(prior.delivery_note_id)
      - prior.revised_cny + (case when p_delivery_note_id=prior.delivery_note_id then p_revised_cny else 0 end)
    then raise exception '更正后应付低于已登记付款，请先由财务核对'; end if;
  end if;
  insert into public.stock_order_shipment_expense_corrections(shipment_id,stock_order_id,
    expense_type,previous_cny,revised_cny,supplier_id,delivery_note_id,expense_item,
    description,reason,created_by)
  values(shipment.id,target.id,p_expense_type,current_cny,p_revised_cny,p_supplier_id,
    p_delivery_note_id,nullif(btrim(coalesce(p_expense_item,'')),''),
    nullif(btrim(coalesce(p_description,'')),''),btrim(p_reason),actor.id)
  returning * into result;
  update public.stock_order_expenses set
    packaging_cost_cny=packaging_cost_cny+case when p_expense_type='PACKAGING' then p_revised_cny-current_cny else 0 end,
    shipping_expenses_cny=shipping_expenses_cny+case when p_expense_type='SHIPPING' then p_revised_cny-current_cny else 0 end,
    procurement_expenses_cny=procurement_expenses_cny+case when p_expense_type='OTHER' then p_revised_cny-current_cny else 0 end,
    updated_by=actor.id,updated_at=now() where stock_order_id=target.id;
  if not found then raise exception '历史费用汇总缺失，请先核对'; end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_SHIPMENT_EXPENSE_CORRECTED','stock_order',target.id,
    jsonb_build_object('shipment_id',shipment.id,'correction_id',result.id,
      'expense_type',p_expense_type,'previous_cny',current_cny,'revised_cny',p_revised_cny,
      'supplier_id',p_supplier_id,'delivery_note_id',p_delivery_note_id,'reason',p_reason));
  return result;
end;
$$;
revoke all on function public.correct_stock_order_shipment_expense(uuid,uuid,text,numeric,numeric,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.correct_stock_order_shipment_expense(uuid,uuid,text,numeric,numeric,uuid,uuid,text,text,text) to authenticated;

create function public.stock_order_shipment_expense_corrections_for_detail(p_stock_order_id uuid)
returns setof public.stock_order_shipment_expense_corrections
language plpgsql security definer set search_path = '' as $$
declare actor public.users;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update')
    or not exists(select 1 from public.stock_orders s where s.id=p_stock_order_id
      and (public.current_user_has_business_permission('stock.data_all') or s.sales_user_id=actor.id))
  then raise exception '无历史费用查看权限'; end if;
  return query select * from public.stock_order_shipment_expense_corrections e
    where e.stock_order_id=p_stock_order_id order by e.created_at desc,e.id desc;
end;
$$;
revoke all on function public.stock_order_shipment_expense_corrections_for_detail(uuid) from public,anon;
grant execute on function public.stock_order_shipment_expense_corrections_for_detail(uuid) to authenticated;

create function public.correct_stock_order_expense_entry(
  p_stock_order_id uuid,p_entry_id uuid,p_expected_cny numeric,p_revised_cny numeric,
  p_supplier_id uuid,p_delivery_note_id uuid,p_expense_item text,
  p_description text,p_reason text
) returns public.stock_order_expense_entry_corrections
language plpgsql security definer set search_path = '' as $$
declare actor public.users; target public.stock_orders; entry public.stock_order_expense_entries;
  prior public.stock_order_expense_entry_corrections; note public.supplier_delivery_notes;
  old_note_id uuid; current_cny numeric; due_cny numeric; paid_cny numeric;
  result public.stock_order_expense_entry_corrections;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无费用更正权限'; end if;
  if p_expected_cny is null or p_revised_cny is null or p_revised_cny<0
    or p_revised_cny>999999999999.99 or p_revised_cny<>round(p_revised_cny,2)
    or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then
    raise exception '请填写有效的更正金额和原因'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null or target.archived_at is not null
    or target.status in ('DRAFT','CANCELLED')
    or (not public.current_user_has_business_permission('stock.data_all')
      and target.sales_user_id is distinct from actor.id) then
    raise exception '备货单不存在或不可更正'; end if;
  select * into entry from public.stock_order_expense_entries
    where id=p_entry_id and stock_order_id=target.id for update;
  if entry.id is null then raise exception '费用记录与备货单不匹配'; end if;
  select * into prior from public.stock_order_expense_entry_corrections
    where entry_id=entry.id order by created_at desc,id desc limit 1;
  current_cny:=coalesce(prior.revised_cny,entry.amount_cny);
  old_note_id:=coalesce(prior.delivery_note_id,entry.delivery_note_id);
  if p_expected_cny<>current_cny then raise exception '费用已被他人更正，请刷新后重试'; end if;
  if entry.expense_type='PACKAGING' and p_revised_cny>0 then
    if p_supplier_id is null or p_delivery_note_id is null then
      raise exception '包装费须关联供应商及真实送货单'; end if;
    select * into note from public.supplier_delivery_notes where id=p_delivery_note_id for update;
    if note.id is null or note.number_pending or note.supplier_id<>p_supplier_id
      or not exists(select 1 from public.supplier_receipt_allocations a
        join public.stock_order_items i on i.id=a.stock_order_item_id
        where a.delivery_note_id=note.id and i.stock_order_id=target.id and a.quantity>0) then
      raise exception '包装费送货单与备货单或供应商不匹配'; end if;
  elsif p_supplier_id is not null or p_delivery_note_id is not null then
    raise exception '零金额或非包装费用不得关联供应商送货单'; end if;
  if entry.expense_type='OTHER' and p_revised_cny>0 and
    (char_length(btrim(coalesce(p_expense_item,''))) not between 2 and 100
      or char_length(btrim(coalesce(p_description,''))) not between 2 and 500) then
    raise exception '其他费用更正须填写项目和说明'; end if;
  if entry.expense_type='PACKAGING' and old_note_id is not null then
    perform 1 from public.supplier_delivery_notes where id=old_note_id for update;
    select coalesce(sum(amount_cny),0) into due_cny from public.supplier_receipt_allocations
      where delivery_note_id=old_note_id;
    select coalesce(sum(amount_cny),0) into paid_cny from public.supplier_payments
      where delivery_note_id=old_note_id;
    if paid_cny>due_cny+public.supplier_note_packaging_cny(old_note_id)
      - current_cny + (case when p_delivery_note_id=old_note_id then p_revised_cny else 0 end) then
      raise exception '更正后应付低于已登记付款，请先由财务核对'; end if;
  end if;
  insert into public.stock_order_expense_entry_corrections(entry_id,stock_order_id,
    previous_cny,revised_cny,supplier_id,delivery_note_id,expense_item,
    description,reason,created_by)
  values(entry.id,target.id,current_cny,p_revised_cny,p_supplier_id,p_delivery_note_id,
    nullif(btrim(coalesce(p_expense_item,'')),''),nullif(btrim(coalesce(p_description,'')),''),
    btrim(p_reason),actor.id) returning * into result;
  update public.stock_order_expenses set
    packaging_cost_cny=packaging_cost_cny+case when entry.expense_type='PACKAGING' then p_revised_cny-current_cny else 0 end,
    shipping_expenses_cny=shipping_expenses_cny+case when entry.expense_type='SHIPPING' then p_revised_cny-current_cny else 0 end,
    procurement_expenses_cny=procurement_expenses_cny+case when entry.expense_type='OTHER' then p_revised_cny-current_cny else 0 end,
    updated_by=actor.id,updated_at=now() where stock_order_id=target.id;
  if not found then raise exception '费用汇总缺失，请先核对'; end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_EXPENSE_ENTRY_CORRECTED','stock_order',target.id,
    jsonb_build_object('entry_id',entry.id,'correction_id',result.id,
      'expense_type',entry.expense_type,'previous_cny',current_cny,'revised_cny',p_revised_cny,
      'old_delivery_note_id',old_note_id,'delivery_note_id',p_delivery_note_id,'reason',btrim(p_reason)));
  return result;
end;
$$;
revoke all on function public.correct_stock_order_expense_entry(uuid,uuid,numeric,numeric,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.correct_stock_order_expense_entry(uuid,uuid,numeric,numeric,uuid,uuid,text,text,text) to authenticated;

create function public.stock_order_expense_entry_corrections_for_detail(p_stock_order_id uuid)
returns setof public.stock_order_expense_entry_corrections
language plpgsql security definer set search_path = '' as $$
declare actor public.users;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update')
    or not exists(select 1 from public.stock_orders s where s.id=p_stock_order_id
      and (public.current_user_has_business_permission('stock.data_all') or s.sales_user_id=actor.id)) then
    raise exception '无费用更正记录查看权限'; end if;
  return query select * from public.stock_order_expense_entry_corrections c
    where c.stock_order_id=p_stock_order_id order by c.created_at desc,c.id desc;
end;
$$;
revoke all on function public.stock_order_expense_entry_corrections_for_detail(uuid) from public,anon;
grant execute on function public.stock_order_expense_entry_corrections_for_detail(uuid) to authenticated;

-- Keep one payable definition across the supplier report, single/batch
-- payments, and receipt reversal. Guarded replacements fail loudly if the
-- existing finance function changes before this migration is applied.
do $migration$
declare
  signature regprocedure;
  definition text;
  old_cte text := $old$  paid as ($old$;
  old_amount text := 'coalesce(a.amount_cny,0) as allocated_cny,';
  old_join text := $old$from filtered_notes n left join allocated a on a.delivery_note_id=n.id
      left join paid p$old$;
  old_note text := $old$'allocated_quantity',n.allocated_quantity,'allocated_cny',n.allocated_cny,$old$;
begin
  foreach signature in array array[
    'public.supplier_reconciliation_report(date,date,uuid,integer,integer)'::regprocedure,
    'public.supplier_reconciliation_report_search(date,date,uuid,integer,integer,text)'::regprocedure
  ] loop
  definition := pg_get_functiondef(signature);
  if strpos(definition,old_cte)=0 or strpos(definition,old_amount)=0
    or strpos(definition,old_join)=0 or strpos(definition,old_note)=0 then
    raise exception '供应商对账口径已变化，请先人工核对迁移';
  end if;
  definition := replace(definition,old_cte,
    $new$  packaging_charges as (
    select n.id as delivery_note_id,public.supplier_note_packaging_cny(n.id) as amount_cny
    from filtered_notes n
  ),
  paid as ($new$);
  definition := replace(definition,old_amount,
    'coalesce(a.amount_cny,0) as goods_allocated_cny, coalesce(a.amount_cny,0)+coalesce(ch.amount_cny,0) as allocated_cny, coalesce(ch.amount_cny,0) as packaging_charges_cny,');
  definition := replace(definition,old_join,
    $new$from filtered_notes n left join allocated a on a.delivery_note_id=n.id
      left join packaging_charges ch on ch.delivery_note_id=n.id
      left join paid p$new$);
  definition := replace(definition,old_note,
    $new$'allocated_quantity',n.allocated_quantity,'allocated_cny',n.allocated_cny,
      'goods_allocated_cny',n.goods_allocated_cny,
      'packaging_charges_cny',n.packaging_charges_cny,$new$);
  execute definition;
  end loop;
end;
$migration$;

do $migration$
declare definition text := pg_get_functiondef('public.record_supplier_payment(uuid,numeric,date,text,text)'::regprocedure);
  marker text := '  select coalesce(sum(amount_cny),0) into paid_amount from public.supplier_payments';
begin
  if strpos(definition,marker)=0 then raise exception '单张付款口径已变化，请人工核对'; end if;
  definition := replace(definition,marker,
    $new$  due_amount := due_amount + public.supplier_note_packaging_cny(delivery.id);
  select coalesce(sum(amount_cny),0) into paid_amount from public.supplier_payments$new$);
  execute definition;
end;
$migration$;

do $migration$
declare definition text := pg_get_functiondef('public.record_supplier_payments_batch(uuid,date,text,text,jsonb)'::regprocedure);
  marker text := $old$      - coalesce((select sum(p.amount_cny) from public.supplier_payments p where p.delivery_note_id = note.id),0)$old$;
begin
  if strpos(definition,marker)=0 then raise exception '批量付款口径已变化，请人工核对'; end if;
  definition := replace(definition,marker,
    $new$      + public.supplier_note_packaging_cny(note.id)
      - coalesce((select sum(p.amount_cny) from public.supplier_payments p where p.delivery_note_id = note.id),0)$new$);
  execute definition;
end;
$migration$;

do $migration$
declare definition text := pg_get_functiondef('public.reverse_supplier_receipt(uuid,uuid,integer,timestamptz,text)'::regprocedure);
  marker text := $old$  select coalesce(sum(amount_cny),0) into paid_amount
    from public.supplier_payments$old$;
begin
  if strpos(definition,marker)=0 then raise exception '回货冲正口径已变化，请人工核对'; end if;
  definition := replace(definition,marker,
    $new$  due_amount := due_amount + public.supplier_note_packaging_cny(allocation.delivery_note_id);
  select coalesce(sum(amount_cny),0) into paid_amount
    from public.supplier_payments$new$);
  execute definition;
end;
$migration$;

do $migration$
declare definition text := pg_get_functiondef('public.record_stock_shipment_quantities(uuid,jsonb,timestamptz,text,numeric,numeric,numeric)'::regprocedure);
  marker text := $old$begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';$old$;
begin
  if strpos(definition,marker)=0 then raise exception '交货代费用入口已变化，请人工核对'; end if;
  definition := replace(definition,marker,
    $new$begin
  if coalesce(p_packaging_cost_cny,0)<>0 or coalesce(p_procurement_expenses_cny,0)<>0
    or coalesce(p_shipping_expenses_cny,0)<>0 then
    raise exception '费用请在备货单独立费用入口登记';
  end if;
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';$new$);
  execute definition;
end;
$migration$;

-- A payment reference is optional even while warehouse documents are pending.
-- Preserve the pending-at-payment flag for follow-up; never fabricate a value.
create or replace function public.reject_pending_supplier_note_payment()
returns trigger language plpgsql set search_path = '' as $$
declare pending_number boolean; pending_photo boolean;
begin
  select n.number_pending into pending_number from public.supplier_delivery_notes n
    where n.id=new.delivery_note_id;
  if pending_number is null then raise exception '送货单不存在'; end if;
  pending_photo := not exists(select 1 from public.attachments a
    where a.supplier_delivery_note_id=new.delivery_note_id);
  if tg_op='INSERT' then
    new.documents_pending_at_payment := pending_number or pending_photo;
  end if;
  return new;
end;
$$;

commit;
