begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.record_supplier_payments_batch(
  p_supplier_id uuid, p_paid_on date, p_payment_method text,
  p_payment_reference text, p_lines jsonb
) returns setof public.supplier_payments
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  line jsonb;
  note public.supplier_delivery_notes;
  result public.supplier_payments;
  actual_unpaid numeric;
  amount numeric;
  expected_unpaid numeric;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role in ('SALES','ORDER_CLERK')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无供应商付款登记权限';
  end if;
  if p_supplier_id is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception '请选择同一供应商的2至50张有效送货单';
  end if;
  if jsonb_array_length(p_lines) not between 2 and 50
    or (select count(distinct value->>'delivery_note_id') from jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines)
    or exists(select 1 from jsonb_array_elements(p_lines) where jsonb_typeof(value) <> 'object'
      or coalesce(value->>'delivery_note_id','') !~* '^[0-9a-f]{8}-[0-9a-f-]{27,}$'
      or coalesce(value->>'amount_cny','') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$'
      or coalesce(value->>'expected_unpaid_cny','') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$') then
    raise exception '请选择同一供应商的2至50张有效送货单，并核对逐张分摊金额';
  end if;

  -- Lock in a stable order so two concurrent batches cannot interleave notes.
  for line in select value from jsonb_array_elements(p_lines) order by value->>'delivery_note_id' loop
    select * into note from public.supplier_delivery_notes
      where id = (line->>'delivery_note_id')::uuid for update;
    if note.id is null or note.supplier_id <> p_supplier_id or note.number_pending then
      raise exception '送货单不存在、供应商不一致或单号待补';
    end if;
    amount := (line->>'amount_cny')::numeric;
    expected_unpaid := (line->>'expected_unpaid_cny')::numeric;
    select coalesce((select sum(a.amount_cny) from public.supplier_receipt_allocations a where a.delivery_note_id = note.id),0)
      - coalesce((select sum(p.amount_cny) from public.supplier_payments p where p.delivery_note_id = note.id),0)
      into actual_unpaid;
    if amount <= 0 or expected_unpaid <> actual_unpaid or amount > actual_unpaid then
      raise exception '送货单 % 的未付余额已变化或分摊金额超额，请刷新后重试', note.note_number;
    end if;
    result := public.record_supplier_payment(note.id, amount, p_paid_on, p_payment_method, p_payment_reference);
    return next result;
  end loop;
end;
$$;
revoke all on function public.record_supplier_payments_batch(uuid,date,text,text,jsonb) from public,anon;
grant execute on function public.record_supplier_payments_batch(uuid,date,text,text,jsonb) to authenticated;
commit;
