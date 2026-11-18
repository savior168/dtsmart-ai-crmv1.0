begin;
set local lock_timeout = '5s';

alter table public.supplier_delivery_notes
  add column number_pending boolean not null default false;
alter table public.supplier_delivery_notes
  add constraint supplier_note_pending_number_check
  check (not number_pending or left(note_number, 11) = '__PENDING__');

-- Keep the existing receipt/stock progress function as the single atomic
-- authority. A provisional number is unique per physical receipt and can
-- never be mistaken for an official supplier document number in the UI.
create function public.record_supplier_receipt_pending(
  p_stock_order_id uuid, p_stock_order_item_id uuid, p_supplier_id uuid,
  p_document_date date, p_quantity integer, p_purchase_unit_price_cny numeric,
  p_expected_updated_at timestamptz, p_note text default null,
  p_cash_paid_reported_cny numeric default null
) returns public.stock_orders
language plpgsql security definer set search_path = '' as $$
declare
  provisional_number text := '__PENDING__' || replace(gen_random_uuid()::text, '-', '');
  updated public.stock_orders;
  delivery_id uuid;
begin
  updated := public.record_supplier_receipt(
    p_stock_order_id, p_stock_order_item_id, p_supplier_id,
    provisional_number, p_document_date, p_quantity, p_purchase_unit_price_cny,
    p_expected_updated_at, p_note, p_cash_paid_reported_cny);
  select id into strict delivery_id from public.supplier_delivery_notes
    where supplier_id = p_supplier_id and note_number = provisional_number for update;
  update public.supplier_delivery_notes set number_pending = true
    where id = delivery_id;
  return updated;
end;
$$;
revoke all on function public.record_supplier_receipt_pending(uuid,uuid,uuid,date,integer,numeric,timestamptz,text,numeric)
  from public, anon;
grant execute on function public.record_supplier_receipt_pending(uuid,uuid,uuid,date,integer,numeric,timestamptz,text,numeric)
  to authenticated;

create function public.record_supplier_receipts_batch_with_pending(
  p_stock_order_id uuid, p_lines jsonb,
  p_expected_updated_at timestamptz, p_note text default null
) returns public.stock_orders
language plpgsql security definer set search_path = '' as $$
declare
  input_line jsonb;
  normalized_lines jsonb := '[]'::jsonb;
  provisional_numbers text[] := '{}';
  provisional_number text;
  updated public.stock_orders;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception '请选择需要登记回货的产品项';
  end if;
  for input_line in select value from jsonb_array_elements(p_lines)
  loop
    if nullif(btrim(coalesce(input_line->>'note_number','')), '') is null then
      provisional_number := '__PENDING__' || replace(gen_random_uuid()::text, '-', '');
      provisional_numbers := array_append(provisional_numbers, provisional_number);
      normalized_lines := normalized_lines || jsonb_build_array(
        input_line || jsonb_build_object('note_number', provisional_number));
    else
      normalized_lines := normalized_lines || jsonb_build_array(input_line);
    end if;
  end loop;
  updated := public.record_supplier_receipts_batch(
    p_stock_order_id, normalized_lines, p_expected_updated_at, p_note);
  if array_length(provisional_numbers, 1) > 0 then
    update public.supplier_delivery_notes set number_pending = true
      where note_number = any(provisional_numbers);
  end if;
  return updated;
end;
$$;
revoke all on function public.record_supplier_receipts_batch_with_pending(uuid,jsonb,timestamptz,text)
  from public, anon;
grant execute on function public.record_supplier_receipts_batch_with_pending(uuid,jsonb,timestamptz,text)
  to authenticated;

create function public.complete_supplier_delivery_note_number(
  p_delivery_note_id uuid, p_note_number text, p_expected_updated_at timestamptz
) returns public.supplier_delivery_notes
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  delivery public.supplier_delivery_notes;
  result public.supplier_delivery_notes;
  normalized_number text := btrim(coalesce(p_note_number, ''));
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role in ('SALES','ORDER_CLERK')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit')
    or not public.current_user_has_business_permission('supplier.documents.view')
    or not public.current_user_has_business_permission('supplier.documents.manage') then
    raise exception '无补录供应商送货单号权限';
  end if;
  if normalized_number = '' or char_length(normalized_number) > 100
    or left(normalized_number, 11) = '__PENDING__' then
    raise exception '请输入真实有效的纸质送货单号';
  end if;
  select * into delivery from public.supplier_delivery_notes
    where id = p_delivery_note_id for update;
  if delivery.id is null or not delivery.number_pending
    or delivery.updated_at is distinct from p_expected_updated_at then
    raise exception '待补送货单已变更，请刷新后重试';
  end if;
  if exists(select 1 from public.supplier_delivery_notes
    where supplier_id = delivery.supplier_id
      and upper(btrim(note_number)) = upper(normalized_number)) then
    raise exception '该供应商送货单号已存在；请核对是否与其他回货记录共用纸单，避免错误合并';
  end if;
  update public.supplier_delivery_notes
    set note_number = normalized_number, number_pending = false, updated_at = now()
    where id = delivery.id returning * into result;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_DELIVERY_NOTE_NUMBER_COMPLETED',
    'supplier_delivery_note',result.id,
    jsonb_build_object('previous_number',delivery.note_number,
      'note_number',normalized_number));
  return result;
end;
$$;
revoke all on function public.complete_supplier_delivery_note_number(uuid,text,timestamptz)
  from public, anon;
grant execute on function public.complete_supplier_delivery_note_number(uuid,text,timestamptz)
  to authenticated;

-- A provisional receipt establishes physical stock but is not a confirmed
-- supplier paper document. It cannot be settled or paper-total-confirmed.
create function public.reject_pending_supplier_note_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.supplier_delivery_notes
    where id = new.delivery_note_id and number_pending) then
    raise exception '请先补录真实送货单号，再登记供应商付款';
  end if;
  return new;
end;
$$;
create trigger supplier_payment_requires_number
  before insert or update of delivery_note_id on public.supplier_payments
  for each row execute function public.reject_pending_supplier_note_payment();

create function public.reject_pending_supplier_note_confirmation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.number_pending and new.paper_total_cny is not null then
    raise exception '请先补录真实送货单号，再核对纸单金额';
  end if;
  return new;
end;
$$;
create trigger supplier_note_confirmation_requires_number
  before insert or update of paper_total_cny, number_pending on public.supplier_delivery_notes
  for each row execute function public.reject_pending_supplier_note_confirmation();

commit;
