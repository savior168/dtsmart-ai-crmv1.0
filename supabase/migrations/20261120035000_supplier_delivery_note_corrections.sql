begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.limit_supplier_delivery_note_images()
returns trigger language plpgsql set search_path = '' as $$
declare current_count integer;
begin
  if new.supplier_delivery_note_id is null then return new; end if;
  perform 1 from public.supplier_delivery_notes where id=new.supplier_delivery_note_id for update;
  if not found then raise exception '供应商送货单不存在'; end if;
  select count(*) into current_count from public.attachments
    where supplier_delivery_note_id=new.supplier_delivery_note_id
      and supplier_photo_superseded_at is null;
  if new.supplier_photo_replaces_id is null then
    if current_count>=10 then raise exception '每张供应商送货单最多保存10张照片'; end if;
  elsif current_count>=11 or not exists(select 1 from public.attachments a
    where a.id=new.supplier_photo_replaces_id
      and a.supplier_delivery_note_id=new.supplier_delivery_note_id
      and a.supplier_photo_superseded_at is null) then
    raise exception '原照片已更换或照片数量超限';
  end if;
  if new.mime_type not in ('image/jpeg','image/png','image/webp')
    or new.size_bytes is null or new.size_bytes<1 or new.size_bytes>5242880 then
    raise exception '送货单照片须为不超过5MB的JPG、PNG或WebP';
  end if;
  return new;
end;
$$;

create function public.correct_supplier_delivery_note_number(
  p_delivery_note_id uuid,p_new_number text,p_expected_updated_at timestamptz,p_reason text
) returns public.supplier_delivery_notes
language plpgsql security definer set search_path = '' as $$
declare actor public.users; note public.supplier_delivery_notes; result public.supplier_delivery_notes;
  normalized text:=btrim(coalesce(p_new_number,''));
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role in ('SALES','ORDER_CLERK')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit')
    or not public.current_user_has_business_permission('supplier.documents.view')
    or not public.current_user_has_business_permission('supplier.documents.manage') then
    raise exception '无更正送货单号权限'; end if;
  if normalized='' or char_length(normalized)>100 or left(normalized,11)='__PENDING__'
    or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then
    raise exception '请输入有效送货单号及更正原因'; end if;
  select * into note from public.supplier_delivery_notes where id=p_delivery_note_id for update;
  if note.id is null or note.number_pending or note.updated_at is distinct from p_expected_updated_at then
    raise exception '送货单已变更，请刷新后重试'; end if;
  if not exists(select 1 from public.supplier_receipt_allocations a
    join public.stock_order_items i on i.id=a.stock_order_item_id
    join public.stock_orders s on s.id=i.stock_order_id
    where a.delivery_note_id=note.id
      and (public.current_user_has_business_permission('stock.data_all') or s.sales_user_id=actor.id)) then
    raise exception '无此送货单关联备货单的操作权限'; end if;
  if upper(btrim(note.note_number))=upper(normalized) then
    raise exception '新送货单号与原号码相同'; end if;
  if exists(select 1 from public.supplier_delivery_notes d where d.supplier_id=note.supplier_id
    and d.id<>note.id and upper(btrim(d.note_number))=upper(normalized)) then
    raise exception '该供应商已有此送货单号；不能把已确认纸单直接合并，请先核对来源'; end if;
  update public.supplier_delivery_notes set note_number=normalized,updated_at=now()
    where id=note.id returning * into result;
  insert into public.supplier_delivery_note_corrections(
    delivery_note_id,correction_type,old_number,new_number,reason,corrected_by)
    values(note.id,'NUMBER',note.note_number,normalized,btrim(p_reason),actor.id);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'SUPPLIER_DELIVERY_NOTE_NUMBER_CORRECTED','supplier_delivery_note',note.id,
      jsonb_build_object('old_number',note.note_number,'new_number',normalized,'reason',btrim(p_reason)));
  return result;
end;
$$;
revoke all on function public.correct_supplier_delivery_note_number(uuid,text,timestamptz,text) from public,anon;
grant execute on function public.correct_supplier_delivery_note_number(uuid,text,timestamptz,text) to authenticated;

create function public.supersede_supplier_delivery_note_photo(
  p_delivery_note_id uuid,p_old_attachment_id uuid,p_new_attachment_id uuid,
  p_expected_updated_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.users; note public.supplier_delivery_notes;
  old_photo public.attachments; new_photo public.attachments;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role in ('SALES','ORDER_CLERK')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit')
    or not public.current_user_has_business_permission('supplier.documents.view')
    or not public.current_user_has_business_permission('supplier.documents.manage') then
    raise exception '无更换送货单照片权限'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then
    raise exception '请填写照片更换原因'; end if;
  select * into note from public.supplier_delivery_notes where id=p_delivery_note_id for update;
  if note.id is null or note.updated_at is distinct from p_expected_updated_at then
    raise exception '送货单已变更，请刷新后重试'; end if;
  if not exists(select 1 from public.supplier_receipt_allocations a
    join public.stock_order_items i on i.id=a.stock_order_item_id
    join public.stock_orders s on s.id=i.stock_order_id
    where a.delivery_note_id=note.id
      and (public.current_user_has_business_permission('stock.data_all') or s.sales_user_id=actor.id)) then
    raise exception '无此送货单关联备货单的操作权限'; end if;
  select * into old_photo from public.attachments where id=p_old_attachment_id for update;
  select * into new_photo from public.attachments where id=p_new_attachment_id for update;
  if old_photo.id is null or new_photo.id is null or old_photo.id=new_photo.id
    or old_photo.supplier_delivery_note_id is distinct from note.id
    or new_photo.supplier_delivery_note_id is distinct from note.id
    or old_photo.supplier_photo_superseded_at is not null
    or new_photo.supplier_photo_superseded_at is not null
    or new_photo.supplier_photo_replaces_id is distinct from old_photo.id
    or new_photo.uploaded_by is distinct from actor.id then
    raise exception '照片已更换或与送货单不匹配，请刷新后重试'; end if;
  update public.attachments set supplier_photo_superseded_at=now(),
    supplier_photo_superseded_by=new_photo.id where id=old_photo.id;
  update public.supplier_delivery_notes set paper_total_cny=null,updated_at=now() where id=note.id;
  insert into public.supplier_delivery_note_corrections(
    delivery_note_id,correction_type,old_attachment_id,new_attachment_id,
    prior_paper_total_cny,reason,corrected_by)
    values(note.id,'PHOTO',old_photo.id,new_photo.id,note.paper_total_cny,btrim(p_reason),actor.id);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'SUPPLIER_DELIVERY_NOTE_PHOTO_REPLACED','supplier_delivery_note',note.id,
      jsonb_build_object('old_attachment_id',old_photo.id,'new_attachment_id',new_photo.id,
        'prior_paper_total_cny',note.paper_total_cny,'reason',btrim(p_reason)));
  return jsonb_build_object('delivery_note_id',note.id,'new_attachment_id',new_photo.id);
end;
$$;
revoke all on function public.supersede_supplier_delivery_note_photo(uuid,uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.supersede_supplier_delivery_note_photo(uuid,uuid,uuid,timestamptz,text) to authenticated;
commit;
