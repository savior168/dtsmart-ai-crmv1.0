-- Run only against a disposable local PostgreSQL database with the project
-- migrations applied. The transaction rolls back all synthetic fixtures.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000101','pi-sales-a@example.invalid','{}'),
  ('00000000-0000-0000-0000-000000000102','pi-sales-b@example.invalid','{}'),
  ('00000000-0000-0000-0000-000000000103','pi-warehouse@example.invalid','{}');
update public.users set status='ACTIVE',role='SALES' where id in
  ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102');
update public.users set status='ACTIVE',role='WAREHOUSE' where id='00000000-0000-0000-0000-000000000103';
insert into public.profiles(id,name,email,phone) values
  ('00000000-0000-0000-0000-000000000101','Sales A','pi-sales-a@example.invalid','+86 13800000000');
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via)
values('00000000-0000-0000-0000-000000000201','Local PI Buyer','GB','CLAIMED','CLAIMED',
  '00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000101','PRIVATE_CREATE');
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via)
values('00000000-0000-0000-0000-000000000202','Local Admin Buyer','US','CLAIMED','CLAIMED',
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001','PRIVATE_CREATE');
insert into public.pi_payment_accounts(id,label,currency,instructions)
values('00000000-0000-0000-0000-000000000301','Local account','USD','Test account only');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
do $$
declare created public.sales_orders;
begin
  created:=public.create_direct_pi_order(
    '00000000-0000-0000-0000-000000000201','WH-LOCAL-001','NGN',200,5,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Buyer receiver','+44 123','buyer@example.invalid','London delivery address',
    'Pack each screen separately',
    '[{"item_name":"Screen","brand":"DT","model":"A1","quality":"ORG","description":"Black screen","description_zh":"黑色屏幕","quantity":2,"unit_price_cny":50,"estimated_unit_cost_cny":30,"preparation_requirement":"Protect glass","internal_note":"Warehouse only"}]'::jsonb);
  if created.status<>'DRAFT' or created.currency<>'NGN' or created.seller_contact_phone<>'+86 13800000000'
    or created.subtotal<>20000
    or created.total_amount<>21000 or created.subtotal_cny<>100 or created.shipping_cny<>5 then
    raise exception 'PI草稿金额、状态或币种不正确';
  end if;
  perform set_config('test.pi_id',created.id::text,true);
end $$;

do $$
declare edited public.sales_orders;
begin
  edited:=public.update_direct_pi_draft(current_setting('test.pi_id')::uuid,1,'WH-LOCAL-001','NGN',200,5,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Buyer receiver','+44 123','buyer@example.invalid','London delivery address',
    'Pack each screen separately',
    '[{"item_name":"Screen","description_zh":"黑色屏幕","quantity":2,"unit_price_cny":50,"estimated_unit_cost_cny":30},{"item_name":"Cable","description_zh":"数据线","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":4}]'::jsonb);
  if edited.pi_revision<>2 or edited.subtotal_cny<>110
    or (select count(*) from public.sales_order_items where sales_order_id=edited.id)<>2 then
    raise exception 'PI草稿追加产品未正确保存';
  end if;
  edited:=public.update_direct_pi_draft(edited.id,2,'WH-LOCAL-001','NGN',200,5,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Buyer receiver','+44 123','buyer@example.invalid','London delivery address',
    'Pack each screen separately',
    '[{"item_name":"Screen","brand":"DT","model":"A1","quality":"ORG","description":"Black screen","description_zh":"黑色屏幕","quantity":2,"unit_price_cny":50,"estimated_unit_cost_cny":30,"preparation_requirement":"Protect glass","internal_note":"Warehouse only"}]'::jsonb);
  if edited.pi_revision<>3 or edited.subtotal_cny<>100
    or (select count(*) from public.sales_order_items where sales_order_id=edited.id)<>1 then
    raise exception 'PI草稿减少产品未正确保存';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.submit_direct_pi_order(current_setting('test.pi_id')::uuid,3);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '非归属销售员提交PI应被拒绝'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
do $$
declare submitted public.sales_orders; stock public.stock_orders;
begin
  submitted:=public.submit_direct_pi_order(current_setting('test.pi_id')::uuid,3);
  select * into stock from public.stock_orders where sales_order_id=submitted.id;
  if submitted.status<>'WAITING_STOCK' or stock.status<>'WAITING'
    or stock.delivery_recipient<>'Buyer receiver' or stock.delivery_address<>'London delivery address'
    or (select count(*) from public.stock_order_items where stock_order_id=stock.id)<>1 then
    raise exception 'PI提交后备货单、收货信息或产品未正确生成';
  end if;
  perform set_config('test.stock_id',stock.id::text,true);
end $$;

do $$
declare recalled public.sales_orders; resubmitted public.sales_orders;
begin
  recalled:=public.recall_direct_pi_order(current_setting('test.pi_id')::uuid,'Correct warehouse handoff');
  if recalled.status<>'DRAFT' or (select status from public.stock_orders where id=current_setting('test.stock_id')::uuid)<>'DRAFT'
    or (select status from public.quotes where id=recalled.quote_id)<>'DRAFT' then
    raise exception '未开工备货单撤回后单据状态不同步';
  end if;
  resubmitted:=public.submit_direct_pi_order(recalled.id,recalled.pi_revision);
  if resubmitted.status<>'WAITING_STOCK'
    or (select status from public.stock_orders where id=current_setting('test.stock_id')::uuid)<>'WAITING' then
    raise exception '撤回后重新提交未恢复待备货状态';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
do $$
declare stock public.stock_orders; rejected boolean:=false;
begin
  stock:=public.update_stock_order_status(current_setting('test.stock_id')::uuid,'PREPARING','Started');
  begin
    perform public.update_stock_order_status(stock.id,'RECEIVED','Goods received');
  exception when others then rejected:=true; end;
  if not rejected then raise exception '未录齐回货数应拒绝已回货状态'; end if;
  perform public.save_stock_receiving_details(stock.id,
    '[{"line_number":1,"received_quantity":2,"warehouse_supplier_code":"SUP-001"}]'::jsonb,
    stock.updated_at);
  perform public.update_stock_order_status(stock.id,'RECEIVED','Goods received');
  perform public.update_stock_order_status(stock.id,'SORTING','Quality checked');
  perform public.update_stock_order_status(stock.id,'READY_TO_SHIP','Packed and ready');
  rejected:=false;
  begin
    perform public.update_stock_order_status(stock.id,'SHIPPED','Courier accepted parcel');
  exception when others then rejected:=true; end;
  if not rejected then raise exception '旧三参数接口不能绕过整单费用'; end if;
  rejected:=false;
  begin
    perform public.update_stock_order_status(stock.id,'SHIPPED','Courier accepted parcel',null,0,0);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '缺少包装费应拒绝已发货'; end if;
  perform public.update_stock_order_status(stock.id,'SHIPPED','Courier accepted parcel',2.50,3.25,0);
  if (select status from public.stock_orders where id=stock.id)<>'SHIPPED'
    or (select status from public.sales_orders where id=current_setting('test.pi_id')::uuid)<>'SHIPPED'
    or not exists(select 1 from public.stock_order_expenses where stock_order_id=stock.id
      and packaging_cost_cny=2.50 and procurement_expenses_cny=3.25 and shipping_expenses_cny=0) then
    raise exception '已发货状态或三项整单费用未原子保存';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.recall_direct_pi_order(current_setting('test.pi_id')::uuid,'Too late');
  exception when others then rejected:=true; end;
  if not rejected then raise exception '仓库已开始备货时不允许销售员单方撤回'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
do $$
begin
  if exists(select 1 from public.stock_order_expenses where stock_order_id=current_setting('test.stock_id')::uuid) then
    raise exception '销售员不应看到仓库整单费用';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$
declare created public.sales_orders;
begin
  created:=public.create_direct_pi_order(
    '00000000-0000-0000-0000-000000000202','WH-ADMIN-001','USD',0.14,0,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Admin buyer',null,null,'Test address','Standard pack',
    '[{"item_name":"Cable","description_zh":"数据线","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":4}]'::jsonb);
  if created.status<>'DRAFT' or created.sales_user_id<>'00000000-0000-0000-0000-000000000001' then
    raise exception '管理员为自身归属客户创建PI失败';
  end if;
end $$;
rollback;
