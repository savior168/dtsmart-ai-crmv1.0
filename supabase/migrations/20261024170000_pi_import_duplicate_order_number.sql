-- Reject an already-used customer order number before creating an import draft.
-- The existing unique sales-order index remains the final concurrency guard
-- when a reviewed import is converted into a PI.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.create_pi_import_draft(p_file_name text,p_sheet_name text,p_payload jsonb)
returns public.pi_import_drafts language plpgsql security definer set search_path='' as $$
declare actor public.users; result public.pi_import_drafts; order_no text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('SALES','SUPERVISOR','ADMIN','ORDER_CLERK')
    or not public.current_user_has_business_permission('orders.import') then raise exception '没有PI导入权限'; end if;
  if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'items')<>'array'
    or jsonb_array_length(p_payload->'items')<1 or jsonb_array_length(p_payload->'items')>500
    or octet_length(p_payload::text)>262144 then raise exception 'PI导入内容不正确或过大'; end if;
  order_no:=nullif(trim(coalesce(p_payload->>'warehouse_reference_number','')),'');
  if order_no is null then raise exception '订单编号不能为空'; end if;
  if length(order_no)>80 then raise exception '订单编号不能超过80字'; end if;
  if exists(select 1 from public.sales_orders o
    where lower(btrim(o.warehouse_reference_number))=lower(order_no)) then
    raise exception '订单编号已存在，请修改模板中的订单编号后重新导入';
  end if;
  insert into public.pi_import_drafts(owner_id,source_file_name,source_sheet_name,source_order_number,payload)
  values(actor.id,left(trim(p_file_name),255),left(trim(p_sheet_name),100),order_no,p_payload) returning * into result;
  return result;
end $$;

commit;
