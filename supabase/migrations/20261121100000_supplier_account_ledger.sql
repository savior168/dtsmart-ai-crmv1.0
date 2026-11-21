begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Supplier-level balances and payments are separate from physical delivery notes.
-- A payment allocation is correspondence, never a second cash movement.
create table public.supplier_account_openings (
  supplier_id uuid primary key references public.suppliers(id) on delete restrict,
  as_of_date date not null,
  balance_cny numeric(18,2) not null check (balance_cny >= 0),
  explanation text not null check (char_length(btrim(explanation)) between 4 and 500),
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create table public.supplier_account_adjustments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  effective_on date not null,
  amount_cny numeric(18,2) not null check (amount_cny <> 0),
  explanation text not null check (char_length(btrim(explanation)) between 4 and 500),
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index supplier_account_adjustments_supplier_date_idx
  on public.supplier_account_adjustments(supplier_id,effective_on);

create table public.supplier_account_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  amount_cny numeric(18,2) not null check (amount_cny > 0),
  paid_on date not null,
  payment_method text not null check (payment_method in ('CASH','BANK','ALIPAY','WECHAT','OTHER')),
  payment_reference text not null default '' check (char_length(payment_reference) <= 200),
  explanation text not null default '' check (char_length(explanation) <= 500),
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  reversed_by uuid references public.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  constraint supplier_account_payment_reversal_check check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (reversed_at is not null and reversed_by is not null
      and char_length(btrim(coalesce(reversal_reason,''))) between 4 and 500)
  )
);
create index supplier_account_payments_supplier_date_idx
  on public.supplier_account_payments(supplier_id,paid_on);
create unique index supplier_account_payments_reference_unique
  on public.supplier_account_payments(payment_method,upper(btrim(payment_reference)))
  where btrim(payment_reference)<>'' and reversed_at is null;

create table public.supplier_account_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  account_payment_id uuid not null references public.supplier_account_payments(id) on delete restrict,
  delivery_note_id uuid not null references public.supplier_delivery_notes(id) on delete restrict,
  amount_cny numeric(18,2) not null check (amount_cny > 0),
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  reversed_by uuid references public.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  constraint supplier_account_allocation_reversal_check check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (reversed_at is not null and reversed_by is not null
      and char_length(btrim(coalesce(reversal_reason,''))) between 4 and 500)
  )
);
create index supplier_account_payment_allocations_note_idx
  on public.supplier_account_payment_allocations(delivery_note_id);

alter table public.supplier_account_openings enable row level security;
alter table public.supplier_account_adjustments enable row level security;
alter table public.supplier_account_payments enable row level security;
alter table public.supplier_account_payment_allocations enable row level security;
revoke all on public.supplier_account_openings,public.supplier_account_adjustments,
  public.supplier_account_payments,public.supplier_account_payment_allocations
  from public,anon,authenticated;

create function public.record_supplier_account_opening(
  p_supplier_id uuid,p_as_of_date date,p_balance_cny numeric,p_explanation text
) returns public.supplier_account_openings
language plpgsql security definer set search_path = '' as $$
declare actor public.users; result public.supplier_account_openings;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无期初账款登记权限'; end if;
  if p_supplier_id is null or p_as_of_date is null or p_as_of_date > current_date
    or p_balance_cny is null or p_balance_cny < 0
    or p_balance_cny > 999999999999.99 or p_balance_cny <> round(p_balance_cny,2)
    or char_length(btrim(coalesce(p_explanation,''))) not between 4 and 500 then
    raise exception '请填写供应商、期初截止日、金额及核对说明'; end if;
  if not exists(select 1 from public.suppliers s where s.id=p_supplier_id and s.is_active) then
    raise exception '请选择已启用的供应商'; end if;
  insert into public.supplier_account_openings(supplier_id,as_of_date,balance_cny,explanation,recorded_by)
  values(p_supplier_id,p_as_of_date,p_balance_cny,btrim(p_explanation),actor.id)
  on conflict(supplier_id) do nothing returning * into result;
  if result.supplier_id is null then raise exception '此供应商已有期初账款，请通过调整流水纠正，勿重复录入'; end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_ACCOUNT_OPENING_RECORDED','supplier',p_supplier_id,
    jsonb_build_object('as_of_date',p_as_of_date,'balance_cny',p_balance_cny,'explanation',p_explanation));
  return result;
end;
$$;
revoke all on function public.record_supplier_account_opening(uuid,date,numeric,text) from public,anon;
grant execute on function public.record_supplier_account_opening(uuid,date,numeric,text) to authenticated;

create function public.record_supplier_account_adjustment(
  p_supplier_id uuid,p_effective_on date,p_amount_cny numeric,p_explanation text,p_request_id uuid
) returns public.supplier_account_adjustments
language plpgsql security definer set search_path = '' as $$
declare actor public.users; opening public.supplier_account_openings; result public.supplier_account_adjustments;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无供应商账款调整权限'; end if;
  select * into opening from public.supplier_account_openings where supplier_id=p_supplier_id for update;
  if opening.supplier_id is null or p_request_id is null or p_effective_on is null
    or p_effective_on <= opening.as_of_date or p_effective_on > current_date
    or p_amount_cny is null or p_amount_cny = 0
    or abs(p_amount_cny) > 999999999999.99 or p_amount_cny <> round(p_amount_cny,2)
    or char_length(btrim(coalesce(p_explanation,''))) not between 4 and 500 then
    raise exception '请选择已建期初账的供应商，填写有效的调整日期、非零金额和原因'; end if;
  insert into public.supplier_account_adjustments(request_id,supplier_id,effective_on,amount_cny,explanation,recorded_by)
  values(p_request_id,p_supplier_id,p_effective_on,p_amount_cny,btrim(p_explanation),actor.id)
  on conflict(request_id) do nothing returning * into result;
  if result.id is null then
    select * into result from public.supplier_account_adjustments where request_id=p_request_id;
    if result.supplier_id is distinct from p_supplier_id or result.effective_on is distinct from p_effective_on
      or result.amount_cny is distinct from p_amount_cny
      or result.explanation is distinct from btrim(p_explanation) then
      raise exception '此提交编号已用于另一笔调整'; end if;
    return result;
  end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_ACCOUNT_ADJUSTMENT_RECORDED','supplier',p_supplier_id,
    jsonb_build_object('adjustment_id',result.id,'amount_cny',p_amount_cny,
      'effective_on',p_effective_on,'explanation',p_explanation));
  return result;
end;
$$;
revoke all on function public.record_supplier_account_adjustment(uuid,date,numeric,text,uuid) from public,anon;
grant execute on function public.record_supplier_account_adjustment(uuid,date,numeric,text,uuid) to authenticated;

create function public.record_supplier_account_payment(
  p_supplier_id uuid,p_amount_cny numeric,p_paid_on date,p_payment_method text,
  p_payment_reference text,p_explanation text,p_request_id uuid
) returns public.supplier_account_payments
language plpgsql security definer set search_path = '' as $$
declare actor public.users; result public.supplier_account_payments;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无供应商总账付款登记权限'; end if;
  if p_supplier_id is null or p_request_id is null or p_amount_cny is null
    or p_amount_cny <= 0 or p_amount_cny > 999999999999.99
    or p_amount_cny <> round(p_amount_cny,2) or p_paid_on is null or p_paid_on > current_date
    or p_payment_method not in ('CASH','BANK','ALIPAY','WECHAT','OTHER')
    or char_length(btrim(coalesce(p_payment_reference,''))) > 200
    or (btrim(coalesce(p_payment_reference,''))='' and char_length(btrim(coalesce(p_explanation,'')))<4)
    or char_length(btrim(coalesce(p_explanation,''))) > 500 then
    raise exception '请填写有效的供应商、付款金额、日期和方式'; end if;
  if not exists(select 1 from public.suppliers s where s.id=p_supplier_id and s.is_active) then
    raise exception '请选择已启用的供应商'; end if;
  select * into result from public.supplier_account_payments where request_id=p_request_id;
  if result.id is not null then
    if result.supplier_id is distinct from p_supplier_id or result.amount_cny is distinct from p_amount_cny
      or result.paid_on is distinct from p_paid_on or result.payment_method is distinct from p_payment_method
      or result.payment_reference is distinct from btrim(coalesce(p_payment_reference,''))
      or result.explanation is distinct from btrim(coalesce(p_explanation,'')) then
      raise exception '此提交编号已用于另一笔付款'; end if;
    return result;
  end if;
  if exists(select 1 from public.supplier_account_openings o
    where o.supplier_id=p_supplier_id and p_paid_on<=o.as_of_date) then
    raise exception '付款日期必须晚于该供应商期初余额截止日，避免重复扣款'; end if;
  if btrim(coalesce(p_payment_reference,''))<>'' then
    perform pg_advisory_xact_lock(hashtextextended(
      p_payment_method || ':' || upper(btrim(p_payment_reference)),0));
    if exists(select 1 from public.supplier_payments p
      join public.supplier_delivery_notes n on n.id=p.delivery_note_id
      where p.payment_method=p_payment_method
        and upper(btrim(p.payment_reference))=upper(btrim(p_payment_reference)))
      or exists(select 1 from public.supplier_account_payments p
        where p.payment_method=p_payment_method
          and p.reversed_at is null
          and upper(btrim(p.payment_reference))=upper(btrim(p_payment_reference))) then
      raise exception '此付款凭证号已登记，请核对是否重复付款'; end if;
  end if;
  insert into public.supplier_account_payments(request_id,supplier_id,amount_cny,paid_on,
    payment_method,payment_reference,explanation,recorded_by)
  values(p_request_id,p_supplier_id,p_amount_cny,p_paid_on,p_payment_method,
    btrim(coalesce(p_payment_reference,'')),btrim(coalesce(p_explanation,'')),actor.id)
  on conflict(request_id) do nothing returning * into result;
  if result.id is null then
    select * into result from public.supplier_account_payments where request_id=p_request_id;
    if result.supplier_id is distinct from p_supplier_id or result.amount_cny is distinct from p_amount_cny
      or result.paid_on is distinct from p_paid_on or result.payment_method is distinct from p_payment_method
      or result.payment_reference is distinct from btrim(coalesce(p_payment_reference,''))
      or result.explanation is distinct from btrim(coalesce(p_explanation,'')) then
      raise exception '此提交编号已用于另一笔付款'; end if;
    return result;
  end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_ACCOUNT_PAYMENT_RECORDED','supplier',p_supplier_id,
    jsonb_build_object('payment_id',result.id,'amount_cny',p_amount_cny,
      'paid_on',p_paid_on,'payment_method',p_payment_method,'payment_reference',result.payment_reference));
  return result;
end;
$$;
revoke all on function public.record_supplier_account_payment(uuid,numeric,date,text,text,text,uuid) from public,anon;
grant execute on function public.record_supplier_account_payment(uuid,numeric,date,text,text,text,uuid) to authenticated;

create function public.reverse_supplier_account_payment(
  p_payment_id uuid,p_reason text
) returns public.supplier_account_payments
language plpgsql security definer set search_path = '' as $$
declare actor public.users; target public.supplier_account_payments;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无供应商付款更正权限'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 4 and 500 then
    raise exception '请填写4至500字的撤销原因'; end if;
  select * into target from public.supplier_account_payments
    where id=p_payment_id for update;
  if target.id is null or target.reversed_at is not null then
    raise exception '付款不存在或已经撤销'; end if;
  if exists(select 1 from public.supplier_account_payment_allocations a
    where a.account_payment_id=target.id and a.reversed_at is null) then
    raise exception '请先更正该付款关联的送货单分配，再撤销付款'; end if;
  update public.supplier_account_payments
    set reversed_at=now(),reversed_by=actor.id,reversal_reason=btrim(p_reason)
    where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_ACCOUNT_PAYMENT_REVERSED','supplier',target.supplier_id,
    jsonb_build_object('payment_id',target.id,'amount_cny',target.amount_cny,
      'reason',p_reason));
  return target;
end;
$$;
revoke all on function public.reverse_supplier_account_payment(uuid,text) from public,anon;
grant execute on function public.reverse_supplier_account_payment(uuid,text) to authenticated;

create function public.supplier_note_account_allocated_cny(p_delivery_note_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.amount_cny),0)
  from public.supplier_account_payment_allocations a
  where a.delivery_note_id=p_delivery_note_id and a.reversed_at is null
$$;
revoke all on function public.supplier_note_account_allocated_cny(uuid) from public,anon,authenticated;

create function public.record_supplier_account_payment_allocation(
  p_account_payment_id uuid,p_delivery_note_id uuid,p_amount_cny numeric,p_request_id uuid
) returns public.supplier_account_payment_allocations
language plpgsql security definer set search_path = '' as $$
declare actor public.users; payment public.supplier_account_payments;
  note public.supplier_delivery_notes; result public.supplier_account_payment_allocations;
  already_allocated numeric; note_due numeric; note_paid numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无供应商付款分配权限'; end if;
  if p_request_id is null or p_amount_cny is null or p_amount_cny<=0
    or p_amount_cny>999999999999.99 or p_amount_cny<>round(p_amount_cny,2) then
    raise exception '请填写有效的分配金额'; end if;
  select * into payment from public.supplier_account_payments where id=p_account_payment_id for update;
  select * into note from public.supplier_delivery_notes where id=p_delivery_note_id for update;
  if payment.id is null or payment.reversed_at is not null
    or note.id is null or note.supplier_id<>payment.supplier_id
    or note.merged_into_id is not null then
    raise exception '付款与送货单必须属于同一供应商，且送货单未归档'; end if;
  select * into result from public.supplier_account_payment_allocations where request_id=p_request_id;
  if result.id is not null then
    if result.account_payment_id<>payment.id or result.delivery_note_id<>note.id
      or result.amount_cny<>p_amount_cny then
      raise exception '此提交编号已用于另一笔分配'; end if;
    return result;
  end if;
  select coalesce(sum(a.amount_cny),0) into already_allocated
    from public.supplier_account_payment_allocations a
    where a.account_payment_id=payment.id and a.reversed_at is null;
  if already_allocated+p_amount_cny>payment.amount_cny then
    raise exception '分配金额超过这笔付款的未分配余额'; end if;
  select coalesce(sum(a.amount_cny),0) into note_due
    from public.supplier_receipt_allocations a where a.delivery_note_id=note.id;
  note_due := note_due+public.supplier_note_packaging_cny(note.id);
  select coalesce(sum(p.amount_cny),0) into note_paid
    from public.supplier_payments p where p.delivery_note_id=note.id;
  note_paid := note_paid+public.supplier_note_account_allocated_cny(note.id);
  if note_paid+p_amount_cny>note_due then
    raise exception '分配金额超过送货单未付余额'; end if;
  insert into public.supplier_account_payment_allocations(request_id,account_payment_id,
    delivery_note_id,amount_cny,recorded_by)
  values(p_request_id,payment.id,note.id,p_amount_cny,actor.id) returning * into result;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_ACCOUNT_PAYMENT_ALLOCATED','supplier_delivery_note',note.id,
    jsonb_build_object('allocation_id',result.id,'payment_id',payment.id,
      'amount_cny',p_amount_cny));
  return result;
end;
$$;
revoke all on function public.record_supplier_account_payment_allocation(uuid,uuid,numeric,uuid)
  from public,anon;
grant execute on function public.record_supplier_account_payment_allocation(uuid,uuid,numeric,uuid)
  to authenticated;

create function public.reverse_supplier_account_payment_allocation(
  p_allocation_id uuid,p_reason text
) returns public.supplier_account_payment_allocations
language plpgsql security definer set search_path = '' as $$
declare actor public.users; target public.supplier_account_payment_allocations;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无付款分配更正权限'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 4 and 500 then
    raise exception '请填写4至500字的更正原因'; end if;
  select * into target from public.supplier_account_payment_allocations
    where id=p_allocation_id;
  if target.id is null or target.reversed_at is not null then
    raise exception '分配记录不存在或已撤销'; end if;
  perform 1 from public.supplier_account_payments where id=target.account_payment_id for update;
  perform 1 from public.supplier_delivery_notes where id=target.delivery_note_id for update;
  update public.supplier_account_payment_allocations
    set reversed_at=now(),reversed_by=actor.id,reversal_reason=btrim(p_reason)
    where id=target.id and reversed_at is null returning * into target;
  if target.id is null then raise exception '分配已被其他用户更正，请刷新'; end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_ACCOUNT_ALLOCATION_REVERSED','supplier_delivery_note',target.delivery_note_id,
    jsonb_build_object('allocation_id',target.id,'payment_id',target.account_payment_id,
      'amount_cny',target.amount_cny,'reason',p_reason));
  return target;
end;
$$;
revoke all on function public.reverse_supplier_account_payment_allocation(uuid,text) from public,anon;
grant execute on function public.reverse_supplier_account_payment_allocation(uuid,text) to authenticated;

-- Current restated balance. Existing paper-note reports remain a separate
-- document-date view; allocation never increases this cash total.
create function public.supplier_account_balances(p_supplier_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor public.users; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.view') then
    raise exception '无供应商总账查看权限'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.system_code),'[]'::jsonb) into result
  from (
    select s.id as supplier_id,s.system_code,
      coalesce(s.short_name,s.english_short_name) as supplier_name,
      o.as_of_date as opening_as_of_date,
      o.balance_cny as opening_balance_cny,
      coalesce(due.amount_cny,0) as new_due_cny,
      coalesce(adj.amount_cny,0) as adjustment_cny,
      coalesce(direct_paid.amount_cny,0) as note_payment_cny,
      coalesce(account_paid.amount_cny,0) as account_payment_cny,
      coalesce(account_paid.unallocated_cny,0) as unallocated_payment_cny,
      coalesce(o.balance_cny,0)+coalesce(due.amount_cny,0)+coalesce(adj.amount_cny,0)
        -coalesce(direct_paid.amount_cny,0)-coalesce(account_paid.amount_cny,0)
        as balance_cny
    from public.suppliers s
    left join public.supplier_account_openings o on o.supplier_id=s.id
    left join lateral (
      select sum(note_due.amount_cny) as amount_cny
      from (
        select n.id,
          coalesce((select sum(a.amount_cny) from public.supplier_receipt_allocations a
            where a.delivery_note_id=n.id),0)
          +public.supplier_note_packaging_cny(n.id) as amount_cny
        from public.supplier_delivery_notes n
        where n.supplier_id=s.id and n.merged_into_id is null
          and (o.as_of_date is null or n.document_date>o.as_of_date)
      ) note_due
    ) due on true
    left join lateral (
      select sum(p.amount_cny) as amount_cny from public.supplier_payments p
      join public.supplier_delivery_notes n on n.id=p.delivery_note_id
      where n.supplier_id=s.id and (o.as_of_date is null or p.paid_on>o.as_of_date)
    ) direct_paid on true
    left join lateral (
      select sum(p.amount_cny) as amount_cny,
        sum(p.amount_cny-coalesce((select sum(a.amount_cny)
          from public.supplier_account_payment_allocations a
          where a.account_payment_id=p.id and a.reversed_at is null),0))
          as unallocated_cny
      from public.supplier_account_payments p
      where p.supplier_id=s.id and p.reversed_at is null
        and (o.as_of_date is null or p.paid_on>o.as_of_date)
    ) account_paid on true
    left join lateral (
      select sum(a.amount_cny) as amount_cny from public.supplier_account_adjustments a
      where a.supplier_id=s.id and (o.as_of_date is null or a.effective_on>o.as_of_date)
    ) adj on true
    where (p_supplier_id is null or s.id=p_supplier_id)
      and (s.is_active or o.supplier_id is not null or due.amount_cny is not null
        or direct_paid.amount_cny is not null or account_paid.amount_cny is not null)
  ) x;
  return result;
end;
$$;
revoke all on function public.supplier_account_balances(uuid) from public,anon;
grant execute on function public.supplier_account_balances(uuid) to authenticated;

create function public.supplier_account_allocatable_notes(
  p_supplier_id uuid,p_search text default ''
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor public.users; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.view') then
    raise exception '无供应商账款查看权限'; end if;
  if p_supplier_id is null or char_length(coalesce(p_search,''))>100 then
    raise exception '请选择供应商并缩短送货单搜索词'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.document_date desc,x.id),'[]'::jsonb)
    into result from (
      select n.id,n.note_number,n.document_date,n.number_pending,
        coalesce((select sum(a.amount_cny) from public.supplier_receipt_allocations a
          where a.delivery_note_id=n.id),0)+public.supplier_note_packaging_cny(n.id) as due_cny,
        coalesce((select sum(p.amount_cny) from public.supplier_payments p
          where p.delivery_note_id=n.id),0)
          +public.supplier_note_account_allocated_cny(n.id) as paid_cny
      from public.supplier_delivery_notes n
      where n.supplier_id=p_supplier_id and n.merged_into_id is null
        and (coalesce(p_search,'')='' or position(lower(p_search) in lower(n.note_number))>0)
      order by n.document_date desc,n.id desc limit 100
    ) x;
  return result;
end;
$$;
revoke all on function public.supplier_account_allocatable_notes(uuid,text) from public,anon;
grant execute on function public.supplier_account_allocatable_notes(uuid,text) to authenticated;

-- Existing note-payment RPCs predate account allocations. A deferred guard
-- closes the race with direct payments and rejects any later due reduction
-- that would make a note overpaid, without changing historical rows.
create function public.assert_supplier_account_note_not_overpaid(p_delivery_note_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare due_cny numeric; paid_cny numeric;
begin
  if p_delivery_note_id is null or not exists(
    select 1 from public.supplier_account_payment_allocations a
    where a.delivery_note_id=p_delivery_note_id and a.reversed_at is null
  ) then return; end if;
  select coalesce(sum(a.amount_cny),0) into due_cny
    from public.supplier_receipt_allocations a where a.delivery_note_id=p_delivery_note_id;
  due_cny := due_cny+public.supplier_note_packaging_cny(p_delivery_note_id);
  select coalesce(sum(p.amount_cny),0) into paid_cny
    from public.supplier_payments p where p.delivery_note_id=p_delivery_note_id;
  paid_cny := paid_cny+public.supplier_note_account_allocated_cny(p_delivery_note_id);
  if paid_cny>due_cny then
    raise exception '送货单已分配付款高于更正后的应付金额，请先核对财务分配'; end if;
end;
$$;
revoke all on function public.assert_supplier_account_note_not_overpaid(uuid)
  from public,anon,authenticated;

create function public.check_supplier_account_note_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    perform public.assert_supplier_account_note_not_overpaid(new.delivery_note_id);
  elsif tg_op='DELETE' then
    perform public.assert_supplier_account_note_not_overpaid(old.delivery_note_id);
  else
    perform public.assert_supplier_account_note_not_overpaid(old.delivery_note_id);
    if new.delivery_note_id is distinct from old.delivery_note_id then
      perform public.assert_supplier_account_note_not_overpaid(new.delivery_note_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.check_supplier_account_note_balance()
  from public,anon,authenticated;

create constraint trigger supplier_account_note_allocation_balance
  after insert or update or delete on public.supplier_account_payment_allocations
  deferrable initially deferred for each row
  execute function public.check_supplier_account_note_balance();
create constraint trigger supplier_account_direct_payment_balance
  after insert or update or delete on public.supplier_payments
  deferrable initially deferred for each row
  execute function public.check_supplier_account_note_balance();
create constraint trigger supplier_account_receipt_balance
  after insert or update or delete on public.supplier_receipt_allocations
  deferrable initially deferred for each row
  execute function public.check_supplier_account_note_balance();
create constraint trigger supplier_account_packaging_balance
  after insert or update or delete on public.stock_order_expense_entries
  deferrable initially deferred for each row
  execute function public.check_supplier_account_note_balance();

create function public.prevent_duplicate_direct_account_voucher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if btrim(coalesce(new.payment_reference,''))='' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    new.payment_method || ':' || upper(btrim(new.payment_reference)),0));
  if exists(select 1 from public.supplier_account_payments a
    where a.payment_method=new.payment_method
      and a.reversed_at is null
      and upper(btrim(a.payment_reference))=upper(btrim(new.payment_reference))) then
    raise exception '此付款凭证号已用于供应商总账付款，请勿重复登记到送货单'; end if;
  return new;
end;
$$;
revoke all on function public.prevent_duplicate_direct_account_voucher()
  from public,anon,authenticated;
create trigger supplier_payment_not_account_duplicate
  before insert or update of payment_reference,payment_method on public.supplier_payments
  for each row execute function public.prevent_duplicate_direct_account_voucher();

-- The paper-note view includes only the portion of account payments explicitly
-- assigned to a note. Supplier-level unassigned cash is counted solely in the
-- account ledger, never fabricated as a settled note.
do $migration$
declare signature regprocedure; definition text;
  old_paid text := $old$  paid as (
    select p.delivery_note_id, coalesce(sum(p.amount_cny),0) as amount_cny
    from public.supplier_payments p join filtered_notes n on n.id=p.delivery_note_id
    group by p.delivery_note_id
  ),$old$;
  new_paid text := $new$  paid as (
    select payments.delivery_note_id, sum(payments.amount_cny) as amount_cny
    from (
      select p.delivery_note_id,p.amount_cny
      from public.supplier_payments p join filtered_notes n on n.id=p.delivery_note_id
      union all
      select a.delivery_note_id,a.amount_cny
      from public.supplier_account_payment_allocations a
      join filtered_notes n on n.id=a.delivery_note_id
      where a.reversed_at is null
    ) payments group by payments.delivery_note_id
  ),$new$;
begin
  foreach signature in array array[
    'public.supplier_reconciliation_report(date,date,uuid,integer,integer)'::regprocedure,
    'public.supplier_reconciliation_report_search(date,date,uuid,integer,integer,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if definition is null or (length(definition)-length(replace(definition,old_paid,'')))
      /length(old_paid)<>1 then
      raise exception '供应商对账函数版本不匹配，未修改'; end if;
    execute replace(definition,old_paid,new_paid);
  end loop;
end;
$migration$;

commit;
