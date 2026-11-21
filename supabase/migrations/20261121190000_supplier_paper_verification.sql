begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A recorded paper amount is not proof that finance checked the photographed
-- products and quantities. Keep confirmations append-only and never backfill.
create table app_private.supplier_note_paper_verifications (
  id uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.supplier_delivery_notes(id) on delete restrict,
  paper_quantity integer not null check (paper_quantity > 0),
  amount_basis text not null check (amount_basis in ('GOODS','GOODS_AND_PACKAGING')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  confirmed_by uuid not null references public.users(id),
  confirmed_at timestamptz not null default clock_timestamp()
);
create index supplier_note_paper_verifications_latest_idx
  on app_private.supplier_note_paper_verifications(delivery_note_id,confirmed_at desc,id desc);
alter table app_private.supplier_note_paper_verifications enable row level security;
revoke all on app_private.supplier_note_paper_verifications from public,anon,authenticated;

create function app_private.supplier_note_paper_snapshot(p_note_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'supplier_id',n.supplier_id,'note_number',n.note_number,
    'document_date',n.document_date,'number_pending',n.number_pending,
    'merged_into_id',n.merged_into_id,'paper_total_cny',n.paper_total_cny,
    'allocations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'item_id',a.stock_order_item_id,'product',a.product_snapshot,
      'quantity',a.quantity,'unit_price_cny',a.purchase_unit_price_cny) order by a.id)
      from public.supplier_receipt_allocations a where a.delivery_note_id=n.id),'[]'::jsonb),
    'photos',coalesce((select jsonb_agg(jsonb_build_object(
      'id',att.id,'path',att.storage_path,'size',att.size_bytes) order by att.id)
      from public.attachments att where att.supplier_delivery_note_id=n.id
        and att.supplier_photo_superseded_at is null),'[]'::jsonb),
    'packaging_cny',public.supplier_note_packaging_cny(n.id),
    'packaging_entries',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'correction_id',c.id,'amount_cny',coalesce(c.revised_cny,e.amount_cny)) order by e.id)
      from public.stock_order_expense_entries e
      left join lateral (select ec.id,ec.revised_cny,ec.delivery_note_id
        from public.stock_order_expense_entry_corrections ec where ec.entry_id=e.id
        order by ec.created_at desc,ec.id desc limit 1) c on true
      where e.expense_type='PACKAGING' and coalesce(c.delivery_note_id,e.delivery_note_id)=n.id),'[]'::jsonb),
    'legacy_packaging',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'shipment_id',c.shipment_id,'amount_cny',c.revised_cny) order by c.id)
      from (select distinct on (shipment_id) id,shipment_id,delivery_note_id,revised_cny
        from public.stock_order_shipment_expense_corrections where expense_type='PACKAGING'
        order by shipment_id,created_at desc,id desc) c where c.delivery_note_id=n.id),'[]'::jsonb)
  ) from public.supplier_delivery_notes n where n.id=p_note_id;
$$;
revoke all on function app_private.supplier_note_paper_snapshot(uuid) from public,anon,authenticated;

create function app_private.supplier_note_paper_is_current(p_note_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select v.snapshot = app_private.supplier_note_paper_snapshot(p_note_id)
    from app_private.supplier_note_paper_verifications v
    where v.delivery_note_id=p_note_id
    order by v.confirmed_at desc,v.id desc limit 1),false);
$$;
revoke all on function app_private.supplier_note_paper_is_current(uuid) from public,anon,authenticated;

create function public.supplier_note_paper_statuses(p_note_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor public.users; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role in ('SALES','ORDER_CLERK')
    or not public.current_user_has_business_permission('supplier.reconciliation.view') then
    raise exception '无纸单核对状态查看权限'; end if;
  if coalesce(array_length(p_note_ids,1),0)>100 then raise exception '单次最多查询100张送货单'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('note_id',n.id,
    'verified',app_private.supplier_note_paper_is_current(n.id),
    'previously_verified',v.id is not null,
    'confirmed_at',v.confirmed_at) order by n.id),'[]'::jsonb) into result
  from (select distinct unnest(p_note_ids) as id) requested
  join public.supplier_delivery_notes n on n.id=requested.id
  left join lateral (select id,confirmed_at from app_private.supplier_note_paper_verifications
    where delivery_note_id=n.id order by confirmed_at desc,id desc limit 1) v on true;
  return result;
end;
$$;
revoke all on function public.supplier_note_paper_statuses(uuid[]) from public,anon;
grant execute on function public.supplier_note_paper_statuses(uuid[]) to authenticated;

create function public.confirm_supplier_note_paper_verification(
  p_delivery_note_id uuid,p_paper_quantity integer,p_expected_updated_at timestamptz,
  p_acknowledged boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.users; note public.supplier_delivery_notes; snapshot jsonb;
  goods_cny numeric; packaging_cny numeric; received_quantity integer; photo_count integer;
  basis text; verification_id uuid;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('FINANCE','ADMIN')
    or not public.current_user_has_business_permission('supplier.reconciliation.manage')
    or not public.current_user_has_business_permission('supplier.documents.view') then
    raise exception '无纸单核对确认权限'; end if;
  if p_acknowledged is distinct from true or p_paper_quantity is null or p_paper_quantity<=0 then
    raise exception '请核对纸单照片上的产品、数量与金额并填写纸单数量'; end if;
  select * into note from public.supplier_delivery_notes where id=p_delivery_note_id for update;
  if note.id is null or note.updated_at is distinct from p_expected_updated_at then
    raise exception '送货单已变更，请刷新后重新核对'; end if;
  if note.number_pending or note.merged_into_id is not null or note.paper_total_cny is null then
    raise exception '请先补齐真实送货单号并登记纸单金额'; end if;
  select coalesce(sum(a.quantity),0),coalesce(sum(a.amount_cny),0)
    into received_quantity,goods_cny from public.supplier_receipt_allocations a
    where a.delivery_note_id=note.id;
  select count(*) into photo_count from public.attachments a
    where a.supplier_delivery_note_id=note.id and a.supplier_photo_superseded_at is null;
  if photo_count=0 then raise exception '请先上传送货单纸质照片'; end if;
  if received_quantity<=0 or p_paper_quantity<>received_quantity then
    raise exception '纸单产品总数量与系统回货数量不一致，请先核对并更正来源'; end if;
  packaging_cny:=public.supplier_note_packaging_cny(note.id);
  if abs(note.paper_total_cny-goods_cny)<=0.005 then basis:='GOODS';
  elsif packaging_cny>0 and abs(note.paper_total_cny-goods_cny-packaging_cny)<=0.005 then
    basis:='GOODS_AND_PACKAGING';
  else raise exception '纸单金额与产品货款或含包装费应付金额均不一致，请先核对差额'; end if;
  if app_private.supplier_note_paper_is_current(note.id) then
    raise exception '这张送货单已完成核对，无需重复确认'; end if;
  snapshot:=app_private.supplier_note_paper_snapshot(note.id);
  insert into app_private.supplier_note_paper_verifications(
    delivery_note_id,paper_quantity,amount_basis,snapshot,confirmed_by)
    values(note.id,p_paper_quantity,basis,snapshot,actor.id) returning id into verification_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'SUPPLIER_PAPER_VERIFIED','supplier_delivery_note',note.id,
      jsonb_build_object('verification_id',verification_id,'paper_quantity',p_paper_quantity,
        'paper_total_cny',note.paper_total_cny,'amount_basis',basis,'photo_count',photo_count));
  return jsonb_build_object('id',verification_id,'note_id',note.id,'verified',true);
end;
$$;
revoke all on function public.confirm_supplier_note_paper_verification(uuid,integer,timestamptz,boolean)
  from public,anon;
grant execute on function public.confirm_supplier_note_paper_verification(uuid,integer,timestamptz,boolean)
  to authenticated;

-- Preserve summary and payment arithmetic. Only narrow the detail status
-- filters so automatic amount equality no longer means human verification.
do $$
declare signature regprocedure; definition text;
  matched_marker text := 'and (abs(n.paper_total_cny - n.goods_allocated_cny) <= 0.005 or abs(n.paper_total_cny - n.allocated_cny) <= 0.005)';
  attention_marker text := 'n.number_pending or n.paper_total_cny is null';
  filter_marker text := 'or (p_check_status = ''MATCHED''';
  validation_marker text := '''AMOUNT_MISMATCH'',''MATCHED'',''NEEDS_ATTENTION''';
  permission_marker text := '''PHOTO_MISSING'',''MATCHED'',''NEEDS_ATTENTION''';
begin
  foreach signature in array array[
    'public.supplier_reconciliation_report_checked(date,date,uuid,integer,integer,text,text)'::regprocedure,
    'public.supplier_reconciliation_report_search_checked(date,date,uuid,integer,integer,text,text,text)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(signature);
    if strpos(definition,matched_marker)=0 or strpos(definition,attention_marker)=0
      or strpos(definition,filter_marker)=0 or strpos(definition,validation_marker)=0
      or strpos(definition,permission_marker)=0 then
      raise exception '供应商核对筛选定义已变更，请人工核对迁移'; end if;
    definition:=replace(definition,matched_marker,
      matched_marker||E'\n          and app_private.supplier_note_paper_is_current(n.id)');
    definition:=replace(definition,attention_marker,
      attention_marker||E'\n          or not app_private.supplier_note_paper_is_current(n.id)');
    definition:=replace(definition,filter_marker,
      E'or (p_check_status = ''REVIEW_PENDING'' and not n.number_pending\n'
      ||E'          and n.paper_total_cny is not null\n'
      ||E'          and (abs(n.paper_total_cny - n.goods_allocated_cny) <= 0.005 or abs(n.paper_total_cny - n.allocated_cny) <= 0.005)\n'
      ||E'          and exists (select 1 from public.attachments att where att.supplier_delivery_note_id=n.id and att.supplier_photo_superseded_at is null)\n'
      ||E'          and not app_private.supplier_note_paper_is_current(n.id))\n        '||filter_marker);
    definition:=replace(definition,validation_marker,
      '''AMOUNT_MISMATCH'',''REVIEW_PENDING'',''MATCHED'',''NEEDS_ATTENTION''');
    definition:=replace(definition,permission_marker,
      '''PHOTO_MISSING'',''REVIEW_PENDING'',''MATCHED'',''NEEDS_ATTENTION''');
    execute definition;
  end loop;
end $$;

commit;
