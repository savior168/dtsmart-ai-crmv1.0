begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Keep the replaced provisional paper's identity for audit, without leaving
-- an empty duplicate in reconciliation or the warehouse document list.
create table public.supplier_delivery_note_merges (
  pending_note_id uuid primary key,
  target_note_id uuid not null references public.supplier_delivery_notes(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  provisional_number text not null,
  document_date date not null,
  allocation_count integer not null,
  attachment_count integer not null,
  merged_by uuid not null references public.users(id),
  merged_at timestamptz not null default now()
);
alter table public.supplier_delivery_note_merges enable row level security;
revoke all on public.supplier_delivery_note_merges from public, anon, authenticated;

alter table public.supplier_delivery_notes
  add column merged_into_id uuid references public.supplier_delivery_notes(id) on delete restrict;
create index supplier_delivery_notes_active_idx on public.supplier_delivery_notes(document_date,supplier_id)
  where merged_into_id is null;

alter table public.attachments
  add column supplier_photo_superseded_at timestamptz,
  add column supplier_photo_superseded_by uuid references public.attachments(id) on delete restrict,
  add column supplier_photo_replaces_id uuid references public.attachments(id) on delete restrict;
create index attachments_supplier_active_photo_idx
  on public.attachments(supplier_delivery_note_id,created_at)
  where supplier_delivery_note_id is not null and supplier_photo_superseded_at is null;

create table public.supplier_delivery_note_corrections (
  id uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.supplier_delivery_notes(id) on delete restrict,
  correction_type text not null check(correction_type in ('NUMBER','PHOTO')),
  old_number text,
  new_number text,
  old_attachment_id uuid references public.attachments(id) on delete restrict,
  new_attachment_id uuid references public.attachments(id) on delete restrict,
  prior_paper_total_cny numeric(18,2),
  reason text not null check(char_length(btrim(reason)) between 2 and 500),
  corrected_by uuid not null references public.users(id),
  corrected_at timestamptz not null default now()
);
create index supplier_note_corrections_note_idx
  on public.supplier_delivery_note_corrections(delivery_note_id,corrected_at desc);
alter table public.supplier_delivery_note_corrections enable row level security;
revoke all on public.supplier_delivery_note_corrections from public,anon,authenticated;

create function public.complete_or_reuse_supplier_delivery_note_number(
  p_delivery_note_id uuid, p_note_number text,
  p_expected_updated_at timestamptz, p_confirm_reuse boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  pending public.supplier_delivery_notes;
  existing public.supplier_delivery_notes;
  normalized text := btrim(coalesce(p_note_number, ''));
  allocation_count integer;
  attachment_count integer;
  target_attachment_count integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role in ('SALES','ORDER_CLERK')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit')
    or not public.current_user_has_business_permission('supplier.documents.view')
    or not public.current_user_has_business_permission('supplier.documents.manage') then
    raise exception '无补录供应商送货单号权限';
  end if;
  if normalized='' or char_length(normalized)>100 or left(normalized,11)='__PENDING__' then
    raise exception '请输入真实有效的纸质送货单号';
  end if;
  select * into pending from public.supplier_delivery_notes
    where id=p_delivery_note_id for update;
  if pending.id is null or not pending.number_pending or pending.merged_into_id is not null
    or pending.updated_at is distinct from p_expected_updated_at then
    raise exception '待补送货单已变更，请刷新后重试';
  end if;
  if not exists(select 1 from public.supplier_receipt_allocations a
    join public.stock_order_items i on i.id=a.stock_order_item_id
    join public.stock_orders s on s.id=i.stock_order_id
    where a.delivery_note_id=pending.id
      and (public.current_user_has_business_permission('stock.data_all') or s.sales_user_id=actor.id)) then
    raise exception '无此送货单关联备货单的操作权限';
  end if;
  select * into existing from public.supplier_delivery_notes
    where supplier_id=pending.supplier_id
      and upper(btrim(note_number))=upper(normalized)
      and id<>pending.id for update;
  if existing.id is null then
    update public.supplier_delivery_notes
      set note_number=normalized,number_pending=false,updated_at=now()
      where id=pending.id;
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
      values(actor.id,'SUPPLIER_DELIVERY_NOTE_NUMBER_COMPLETED',
        'supplier_delivery_note',pending.id,
        jsonb_build_object('previous_number',pending.note_number,'note_number',normalized));
    return jsonb_build_object('status','completed','delivery_note_id',pending.id);
  end if;
  if existing.number_pending or existing.document_date<>pending.document_date then
    raise exception '同号纸单日期不同或仍待补号；请先核对实物，不能自动合并';
  end if;
  if not exists(select 1 from public.supplier_receipt_allocations a
    join public.stock_order_items i on i.id=a.stock_order_item_id
    join public.stock_orders s on s.id=i.stock_order_id
    where a.delivery_note_id=existing.id
      and (public.current_user_has_business_permission('stock.data_all') or s.sales_user_id=actor.id)) then
    raise exception '无已有送货单关联备货单的操作权限';
  end if;
  if pending.paper_total_cny is not null
    or exists(select 1 from public.supplier_payments p where p.delivery_note_id=pending.id)
    or exists(select 1 from public.stock_order_expense_entries e where e.delivery_note_id=pending.id)
    or exists(select 1 from public.stock_order_shipment_expense_corrections e where e.delivery_note_id=pending.id) then
    raise exception '待补纸单已有金额、付款或费用关联，不能自动合并；请联系财务核对';
  end if;
  select count(*) into allocation_count from public.supplier_receipt_allocations
    where delivery_note_id=pending.id;
  select count(*) into attachment_count from public.attachments
    where supplier_delivery_note_id=pending.id and supplier_photo_superseded_at is null;
  select count(*) into target_attachment_count from public.attachments
    where supplier_delivery_note_id=existing.id and supplier_photo_superseded_at is null;
  if attachment_count+target_attachment_count>10 then
    raise exception '合并后纸单照片超过10张上限，请先人工核对重复凭证';
  end if;
  if not p_confirm_reuse then
    return jsonb_build_object('status','confirm_reuse',
      'target_note_id',existing.id,'note_number',existing.note_number,
      'document_date',existing.document_date,
      'allocation_count',allocation_count,'attachment_count',attachment_count);
  end if;
  update public.supplier_receipt_allocations set delivery_note_id=existing.id
    where delivery_note_id=pending.id;
  update public.attachments set supplier_delivery_note_id=existing.id
    where supplier_delivery_note_id=pending.id;
  update public.supplier_delivery_note_corrections set delivery_note_id=existing.id
    where delivery_note_id=pending.id;
  update public.supplier_delivery_notes set merged_into_id=existing.id,updated_at=now()
    where id=pending.id;
  insert into public.supplier_delivery_note_merges(
    pending_note_id,target_note_id,supplier_id,provisional_number,
    document_date,allocation_count,attachment_count,merged_by)
  values(pending.id,existing.id,pending.supplier_id,pending.note_number,
    pending.document_date,allocation_count,attachment_count,actor.id);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'SUPPLIER_DELIVERY_NOTE_REUSED','supplier_delivery_note',existing.id,
      jsonb_build_object('pending_note_id',pending.id,
        'provisional_number',pending.note_number,'note_number',existing.note_number,
        'allocation_count',allocation_count,'attachment_count',attachment_count));
  return jsonb_build_object('status','reused','delivery_note_id',existing.id);
end;
$$;
revoke all on function public.complete_or_reuse_supplier_delivery_note_number(uuid,text,timestamptz,boolean) from public,anon;
grant execute on function public.complete_or_reuse_supplier_delivery_note_number(uuid,text,timestamptz,boolean) to authenticated;
revoke execute on function public.complete_supplier_delivery_note_number(uuid,text,timestamptz)
  from authenticated;

-- An archived provisional row remains for audit, but is not another payable
-- document. Keep both the normal and searchable reports on this same rule.
do $migration$
declare signature regprocedure; definition text;
  marker text := 'where d.document_date between p_date_from and p_date_to';
begin
  foreach signature in array array[
    'public.supplier_reconciliation_report(date,date,uuid,integer,integer)'::regprocedure,
    'public.supplier_reconciliation_report_search(date,date,uuid,integer,integer,text)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(signature);
    if strpos(definition,marker)=0 then
      raise exception '对账报表过滤条件已变化，请人工核对'; end if;
    definition:=replace(definition,marker,marker||E'\n        and d.merged_into_id is null');
    execute definition;
  end loop;
end;
$migration$;
commit;
