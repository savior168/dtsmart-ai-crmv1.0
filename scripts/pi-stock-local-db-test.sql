-- Run only against a disposable local PostgreSQL database with the project
-- migrations applied. The transaction rolls back all synthetic fixtures.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000101','pi-sales-a@example.invalid','{}'),
  ('00000000-0000-0000-0000-000000000102','pi-sales-b@example.invalid','{}'),
  ('00000000-0000-0000-0000-000000000103','pi-warehouse@example.invalid','{}'),
  ('00000000-0000-0000-0000-000000000104','pi-supervisor@example.invalid','{}');
update public.users set status='ACTIVE',role='SALES' where id in
  ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102');
update public.users set status='ACTIVE',role='WAREHOUSE' where id='00000000-0000-0000-0000-000000000103';
update public.users set status='ACTIVE',role='SUPERVISOR' where id='00000000-0000-0000-0000-000000000104';
insert into public.profiles(id,name,email,phone,business_phone,business_email) values
  ('00000000-0000-0000-0000-000000000101','Sales A','pi-sales-a@example.invalid','+86 13800000000',
   '+86 13900000000','sales-a-business@example.invalid');
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
declare rejected boolean:=false;
begin
  begin
    perform public.create_direct_pi_order(
      '00000000-0000-0000-0000-000000000201','WH-LOSS-001','NGN',200,5,
      'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
      'Buyer receiver',null,null,'London delivery address','Standard pack',
      '[{"item_name":"Loss item","brand":"DT","model":"L1","quality":"ORG","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":10}]'::jsonb);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '售价不高于成本的PI应被拒绝'; end if;
end $$;

do $$
declare created public.sales_orders;
begin
  created:=public.create_direct_pi_order(
    '00000000-0000-0000-0000-000000000201','WH-LOCAL-001','NGN',200,5,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Buyer receiver','+44 123','buyer@example.invalid','London delivery address',
    'Pack each screen separately',
    '[{"item_name":"Screen","brand":"DT","model":"A1","quality":"ORG","description":"Black screen","description_zh":"黑色屏幕","quantity":2,"unit_price_cny":50,"estimated_unit_cost_cny":30,"preparation_requirement":"Protect glass","internal_note":"Warehouse only"}]'::jsonb);
  if created.status<>'DRAFT' or created.currency<>'NGN' or created.seller_contact_phone<>'+86 13900000000'
    or created.seller_contact_email<>'sales-a-business@example.invalid'
    or created.subtotal<>20000
    or created.total_amount<>21000 or created.subtotal_cny<>100 or created.shipping_cny<>5 then
    raise exception 'PI草稿金额、状态或币种不正确';
  end if;
  perform set_config('test.pi_id',created.id::text,true);
end $$;

do $$
declare rejected boolean:=false;
begin
  begin
    perform public.update_direct_pi_draft(current_setting('test.pi_id')::uuid,null,
      'WH-LOCAL-001','NGN',200,5,'Bank transfer',
      '00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
      'Buyer receiver','+44 123','buyer@example.invalid','London delivery address',
      'Pack each screen separately',
      '[{"item_name":"Screen","brand":"DT","model":"A1","quality":"ORG","description_zh":"黑色屏幕","quantity":2,"unit_price_cny":50,"estimated_unit_cost_cny":30}]'::jsonb);
  exception when others then
    if SQLERRM like '%PI草稿已被其他操作修改%' then rejected:=true; else raise; end if;
  end;
  if not rejected then raise exception '空版本号不得绕过PI草稿并发校验'; end if;
end $$;

do $$
declare edited public.sales_orders;
begin
  edited:=public.update_direct_pi_draft(current_setting('test.pi_id')::uuid,1,'WH-LOCAL-001','NGN',200,5,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Buyer receiver','+44 123','buyer@example.invalid','London delivery address',
    'Pack each screen separately',
    '[{"item_name":"Screen","brand":"DT","model":"A1","quality":"ORG","description_zh":"黑色屏幕","quantity":2,"unit_price_cny":50,"estimated_unit_cost_cny":30},{"item_name":"Cable","brand":"DT","model":"C1","quality":"ORG","description_zh":"数据线","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":4}]'::jsonb);
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
declare rejected boolean:=false;
begin
  begin
    perform public.submit_direct_pi_order(current_setting('test.pi_id')::uuid,null);
  exception when others then
    if SQLERRM like '%PI草稿已更新%' then rejected:=true; else raise; end if;
  end;
  if not rejected then raise exception '空版本号不得绕过PI提交并发校验'; end if;
end $$;
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
declare recalled public.sales_orders; resubmitted public.sales_orders; rejected boolean:=false;
begin
  recalled:=public.recall_direct_pi_order(current_setting('test.pi_id')::uuid,'Correct warehouse handoff');
  if recalled.status<>'DRAFT' or (select status from public.stock_orders where id=current_setting('test.stock_id')::uuid)<>'DRAFT'
    or (select status from public.quotes where id=recalled.quote_id)<>'DRAFT' then
    raise exception '未开工备货单撤回后单据状态不同步';
  end if;
  begin
    perform public.delete_never_submitted_pi_draft(recalled.id,recalled.pi_revision);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '已提交又撤回的PI草稿不得物理删除'; end if;
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
  rejected:=false;
  begin
    perform public.delete_never_submitted_pi_draft(current_setting('test.pi_id')::uuid,3);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '已发货PI不得物理删除'; end if;
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
declare created public.sales_orders; rejected boolean:=false;
begin
  created:=public.create_direct_pi_order(
    '00000000-0000-0000-0000-000000000202','WH-ADMIN-001','USD',0.14,0,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Admin buyer',null,null,'Test address','Standard pack',
    '[{"item_name":"Cable","brand":"DT","model":"C1","quality":"ORG","description_zh":"数据线","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":4}]'::jsonb);
  if created.status<>'DRAFT' or created.sales_user_id<>'00000000-0000-0000-0000-000000000001' then
    raise exception '管理员为自身归属客户创建PI失败';
  end if;
  created:=public.set_direct_pi_change_note(created.id,created.pi_revision,'1. Customer added a cable');
  if created.confirmation_note<>'1. Customer added a cable' then
    raise exception 'PI草稿变更说明未保存';
  end if;
  begin
    perform public.set_direct_pi_change_note(created.id,created.pi_revision-1,'Stale edit');
  exception when others then rejected:=true; end;
  if not rejected then raise exception '过期版本不得覆盖PI变更说明'; end if;
  rejected:=false;
  begin
    perform public.create_direct_pi_order(
      '00000000-0000-0000-0000-000000000201','WH-ADMIN-CROSS-001','USD',0.14,0,
      'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
      'Other owner buyer',null,null,'Test address','Standard pack',
      '[{"item_name":"Cable","brand":"DT","model":"C1","quality":"ORG","description_zh":"数据线","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":4}]'::jsonb);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '管理员不应为他人归属客户创建PI'; end if;
  perform public.delete_never_submitted_pi_draft(created.id,created.pi_revision);
  if exists(select 1 from public.sales_orders where id=created.id)
    or exists(select 1 from public.quotes where id=created.quote_id)
    or not exists(select 1 from public.audit_logs where target_id=created.id and action='PI_DRAFT_DELETE') then
    raise exception '管理员删除自身未提交草稿后应删除明细并留下审计';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
do $$
declare created public.sales_orders; rejected boolean:=false;
begin
  created:=public.create_direct_pi_order(
    '00000000-0000-0000-0000-000000000201','WH-DELETE-001','USD',0.14,0,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Buyer receiver',null,null,'Test address','Standard pack',
    '[{"item_name":"Cable","brand":"DT","model":"C1","quality":"ORG","description_zh":"数据线","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":4}]'::jsonb);
  perform set_config('test.delete_id',created.id::text,true);
  begin
    perform public.delete_never_submitted_pi_draft(created.id,null);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '空版本号不得绕过草稿删除并发校验'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.delete_never_submitted_pi_draft(current_setting('test.delete_id')::uuid,1);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '非归属销售员不得删除草稿'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.delete_never_submitted_pi_draft(current_setting('test.delete_id')::uuid,1);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '仓库员不得删除PI草稿'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$
begin
  perform public.delete_never_submitted_pi_draft(current_setting('test.delete_id')::uuid,1);
  if exists(select 1 from public.sales_orders where id=current_setting('test.delete_id')::uuid) then
    raise exception '管理员应能删除销售员从未提交的PI草稿';
  end if;
end $$;
-- Two-line warehouse flow: line status is independent; parent status follows
-- the earliest unfinished line, and physical receipts cannot regress.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
do $$
declare created public.sales_orders; stock public.stock_orders;
begin
  created:=public.create_direct_pi_order(
    '00000000-0000-0000-0000-000000000201','WH-LINES-001','USD',0.14,0,
    'Bank transfer','00000000-0000-0000-0000-000000000301',current_date+30,current_date+15,
    'Buyer receiver',null,null,'Test address','Standard pack',
    '[{"item_name":"Screen","brand":"DT","model":"A1","quality":"ORG","description_zh":"屏幕","quantity":2,"unit_price_cny":50,"estimated_unit_cost_cny":30},{"item_name":"Cable","brand":"DT","model":"C1","quality":"ORG","description_zh":"数据线","quantity":1,"unit_price_cny":10,"estimated_unit_cost_cny":4}]'::jsonb);
  perform public.submit_direct_pi_order(created.id,created.pi_revision);
  select * into stock from public.stock_orders where sales_order_id=created.id;
  perform set_config('test.lines_stock_id',stock.id::text,true);
  perform set_config('test.lines_pi_id',created.id::text,true);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
do $$
declare stock public.stock_orders; line_id uuid; rejected boolean:=false;
begin
  if exists(select 1 from public.stock_orders where id=current_setting('test.lines_stock_id')::uuid) then
    raise exception '其他销售员不得查看此备货单'; end if;
  select * into stock from public.stock_orders where id=current_setting('test.lines_stock_id')::uuid;
  select id into line_id from public.stock_order_items where stock_order_id=stock.id and line_number=1;
  begin
    perform public.update_stock_item_stages(stock.id,jsonb_build_array(jsonb_build_object('item_id',line_id,'status','PREPARING')),
      stock.updated_at,'Sales bypass');
  exception when others then rejected:=true; end;
  if not rejected then raise exception '销售员不得更新备货项状态'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000104',true);
do $$
begin
  if exists(select 1 from public.stock_orders where id=current_setting('test.lines_stock_id')::uuid) then
    raise exception '主管不得越权查看非本人备货单'; end if;
  if exists(select 1 from public.sales_orders o where o.id=current_setting('test.lines_pi_id')::uuid) then
    raise exception '主管不得越权查看非本人PI'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
do $$
declare stock public.stock_orders; line_id uuid; rejected boolean:=false;
begin
  select * into stock from public.stock_orders where id=current_setting('test.lines_stock_id')::uuid;
  if stock.id is null then raise exception '仓库员必须能查看所有正式备货单'; end if;
  select id into line_id from public.stock_order_items where stock_order_id=stock.id and line_number=1;
  begin
    perform public.update_stock_item_stages(stock.id,jsonb_build_array(jsonb_build_object('item_id',line_id,'status','RECEIVED')),
      stock.updated_at,'Skip stage');
  exception when others then rejected:=true; end;
  if not rejected then raise exception '产品不得跳级'; end if;
  stock:=public.update_stock_item_stages(stock.id,jsonb_build_array(jsonb_build_object('item_id',line_id,'status','PREPARING')),
    stock.updated_at,'Started first line');
  if stock.status<>'WAITING' or (select preparation_status from public.stock_order_items where id=line_id)<>'PREPARING' then
    raise exception '逐项备货不应推进尚未开工的其他项或整单状态'; end if;
  begin
    perform public.update_stock_item_stages(stock.id,jsonb_build_array(jsonb_build_object('item_id',line_id,'status','RECEIVED')),
      stock.updated_at,'No receipt yet');
  exception when others then rejected:=true; end;
  if not rejected then raise exception '未回齐不得标记已回货'; end if;
  perform public.save_stock_receiving_details(stock.id,
    '[{"line_number":1,"received_quantity":2,"warehouse_supplier_code":"SUP-001"},{"line_number":2,"received_quantity":0,"warehouse_supplier_code":""}]'::jsonb,stock.updated_at);
  select * into stock from public.stock_orders where id=stock.id;
  stock:=public.update_stock_item_stages(stock.id,jsonb_build_array(jsonb_build_object('item_id',line_id,'status','RECEIVED')),
    stock.updated_at,'First line received');
  rejected:=false;
  begin
    perform public.save_stock_receiving_details(stock.id,
      '[{"line_number":1,"received_quantity":1,"warehouse_supplier_code":"SUP-001"},{"line_number":2,"received_quantity":0,"warehouse_supplier_code":""}]'::jsonb,stock.updated_at);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '已回货产品不得把回货数改少'; end if;
  if stock.status<>'WAITING' or (select count(*) from public.stock_order_items where stock_order_id=stock.id and preparation_status='WAITING')<>1 then
    raise exception '逐项状态不能误覆盖其他产品'; end if;
end $$;
rollback;
