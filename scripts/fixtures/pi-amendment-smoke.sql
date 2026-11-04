-- Run only after supplier-ledger-bootstrap.sql, pi-shipped-line-guard-smoke.sql,
-- and pi-seller-cost-review-smoke.sql on an isolated empty database.
alter table public.sales_orders add column quote_id uuid, add column pi_revision integer not null default 1,
  add column fx_rate_cny_to_payment numeric(18,6), add column shipping_cny numeric(14,2) default 0,
  add column shipping_cost numeric(14,2) default 0, add column last_balance_cny numeric(14,2) default 0,
  add column last_balance_amount numeric(14,2) default 0, add column other_charge_cny numeric(14,2) default 0,
  add column other_charge_amount numeric(14,2) default 0, add column discount_cny numeric(14,2) default 0,
  add column discount_amount numeric(14,2) default 0, add column paypal_fee_percent numeric(8,4) default 0,
  add column paypal_fee_cny numeric(14,2) default 0, add column paypal_fee_amount numeric(14,2) default 0,
  add column subtotal_cny numeric(14,2) default 0, add column subtotal numeric(14,2) default 0,
  add column total_cny numeric(14,2) default 0, add column total_amount numeric(14,2) default 0,
  add column updated_at timestamptz default now();
alter table public.sales_order_items add column unit_price numeric(14,2) default 0,
  add column amount numeric(14,2);
alter table public.stock_orders add column updated_by uuid;
insert into public.users(id,role,status)
values('88888888-8888-4888-8888-888888888881','SALES','ACTIVE'),
  ('88888888-8888-4888-8888-888888888882','WAREHOUSE','ACTIVE'),
  ('88888888-8888-4888-8888-888888888883','SUPERVISOR','ACTIVE');
insert into public.quotes(id,subtotal_cny,subtotal,total_cny,total_amount,amount)
values('88888888-8888-4888-8888-888888888884',1000,150,1000,150,150);
insert into public.sales_orders(id,order_number,sales_user_id,confirmation_method,status,quote_id,
  pi_revision,fx_rate_cny_to_payment,subtotal_cny,subtotal,total_cny,total_amount)
values('88888888-8888-4888-8888-888888888885','PI-AMEND-TEST',
  '88888888-8888-4888-8888-888888888881','DIRECT_PI','PREPARING',
  '88888888-8888-4888-8888-888888888884',2,0.15,1000,150,1000,150);
insert into public.sales_order_items(id,sales_order_id,line_number,item_name,brand,model,quality,
  description,description_zh,quantity,unit_price,unit_price_cny,estimated_unit_cost_cny)
values('88888888-8888-4888-8888-888888888886',
  '88888888-8888-4888-8888-888888888885',1,'LCD','MAC','A2338','Original',
  'screen','原装屏',10,15,100,60);
insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,description,
  description_zh,quantity,unit_price,unit_price_cny,unit_cost_cny,procurement_cost)
values('88888888-8888-4888-8888-888888888884',1,'LCD','MAC','A2338','Original',
  'screen','原装屏',10,15,100,60,0);
insert into public.stock_orders(id,sales_order_id,status)
values('88888888-8888-4888-8888-888888888887',
  '88888888-8888-4888-8888-888888888885','PREPARING');
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,brand,model,
  quality,description,description_zh,quantity,received_quantity,prepared_quantity,
  shipped_quantity,preparation_status,estimated_unit_cost_cny)
values('88888888-8888-4888-8888-888888888888',
  '88888888-8888-4888-8888-888888888887',1,'LCD','MAC','A2338','Original',
  'screen','原装屏',10,3,0,0,'PREPARING',60);

do $$
declare req public.pi_amendment_requests; blocked boolean; result public.pi_amendment_requests;
  proposal jsonb := jsonb_build_array(
    jsonb_build_object('id','88888888-8888-4888-8888-888888888886','item_name','LCD',
      'brand','MAC','model','A2338','quality','Original','description','screen',
      'description_zh','原装屏','quantity',12,'unit_price_cny',100,'estimated_unit_cost_cny',60),
    jsonb_build_object('id','88888888-8888-4888-8888-888888888889','item_name','Cable',
      'brand','MAC','model','C1','quality','Original','description','',
      'description_zh','数据线','quantity',2,'unit_price_cny',50,'estimated_unit_cost_cny',20));
begin
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888883',true);
  blocked:=false;
  begin perform public.request_direct_pi_amendment(
    '88888888-8888-4888-8888-888888888885',2,proposal,'manager must not change staff PI');
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'supervisor changed another creator PI'; end if;
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
  req:=public.request_direct_pi_amendment(
    '88888888-8888-4888-8888-888888888885',2,proposal,'customer adds two cables');
  if req.status<>'PENDING' or cardinality(req.affected_stock_item_ids)<>1 then
    raise exception 'amendment request not frozen with affected line'; end if;
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888883',true);
  blocked:=false;
  begin perform public.withdraw_direct_pi_amendment(
    '88888888-8888-4888-8888-888888888885',req.id);
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'non-creator withdrew PI amendment'; end if;
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
  result:=public.withdraw_direct_pi_amendment(
    '88888888-8888-4888-8888-888888888885',req.id);
  if result.status<>'WITHDRAWN' or (select count(*) from public.pi_amendment_requests
    where sales_order_id='88888888-8888-4888-8888-888888888885' and status='APPLIED')<>0 then
    raise exception 'withdrawn PI request changed order or allowance'; end if;
  req:=public.request_direct_pi_amendment(
    '88888888-8888-4888-8888-888888888885',2,proposal,'customer adds two cables');
  blocked:=false;
  begin update public.stock_order_items set prepared_quantity=1
    where id='88888888-8888-4888-8888-888888888888';
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'affected warehouse line was not frozen'; end if;
  blocked:=false;
  begin update public.stock_orders set status='SHIPPED'
    where id='88888888-8888-4888-8888-888888888887';
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'full handoff bypassed pending amendment'; end if;
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888882',true);
  result:=public.decide_direct_pi_amendment(req.id,true,'confirmed no shipped goods');
  if result.status<>'APPLIED' or result.applied_revision<>3
    or (select count(*) from public.sales_order_items
      where sales_order_id='88888888-8888-4888-8888-888888888885')<>2
    or (select count(*) from public.quote_items
      where quote_id='88888888-8888-4888-8888-888888888884')<>2
    or (select count(*) from public.stock_order_items
      where stock_order_id='88888888-8888-4888-8888-888888888887')<>2
    or (select subtotal_cny from public.sales_orders
      where id='88888888-8888-4888-8888-888888888885')<>1300
    or (select amount from public.sales_order_items where id='88888888-8888-4888-8888-888888888889')<>15
    or (select amount from public.quote_items where quote_id='88888888-8888-4888-8888-888888888884' and line_number=2)<>15 then
    raise exception 'PI, quote, stock and totals were not atomically synchronized'; end if;
end $$;

-- A separate partially shipped PI covers deletion, received-product identity,
-- and the rule that even a partial handoff permanently locks that product row.
insert into public.quotes(id) values('99999999-9999-4999-8999-999999999991');
insert into public.sales_orders(id,order_number,sales_user_id,confirmation_method,status,quote_id,
  pi_revision,fx_rate_cny_to_payment,subtotal_cny,subtotal,total_cny,total_amount)
values('99999999-9999-4999-8999-999999999992','PI-AMEND-EDGE',
  '88888888-8888-4888-8888-888888888881','DIRECT_PI','PREPARING',
  '99999999-9999-4999-8999-999999999991',1,0.15,600,90,600,90);
insert into public.stock_orders(id,sales_order_id,status)
values('99999999-9999-4999-8999-999999999993',
  '99999999-9999-4999-8999-999999999992','PREPARING');
insert into public.sales_order_items(id,sales_order_id,line_number,item_name,brand,model,quality,
  description,description_zh,quantity,unit_price,unit_price_cny,amount,estimated_unit_cost_cny)
values
('99999999-9999-4999-8999-999999999994','99999999-9999-4999-8999-999999999992',1,
  'Cable','MAC','C2','A','','线材',3,15,100,45,60),
('99999999-9999-4999-8999-999999999995','99999999-9999-4999-8999-999999999992',2,
  'LCD','MAC','A2338','A','','屏幕',2,15,100,30,60),
('99999999-9999-4999-8999-999999999996','99999999-9999-4999-8999-999999999992',3,
  'Battery','MAC','B1','A','','电池',1,15,100,15,60);
insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,
  description,description_zh,quantity,unit_price,unit_price_cny,amount,unit_cost_cny,procurement_cost)
values
('99999999-9999-4999-8999-999999999991',1,'Cable','MAC','C2','A','','线材',3,15,100,45,60,0),
('99999999-9999-4999-8999-999999999991',2,'LCD','MAC','A2338','A','','屏幕',2,15,100,30,60,0),
('99999999-9999-4999-8999-999999999991',3,'Battery','MAC','B1','A','','电池',1,15,100,15,60,0);
insert into public.stock_order_items(stock_order_id,line_number,item_name,brand,model,quality,
  description,description_zh,quantity,received_quantity,prepared_quantity,shipped_quantity,
  preparation_status,estimated_unit_cost_cny)
values
('99999999-9999-4999-8999-999999999993',1,'Cable','MAC','C2','A','','线材',3,0,0,0,'WAITING',60),
('99999999-9999-4999-8999-999999999993',2,'LCD','MAC','A2338','A','','屏幕',2,1,0,0,'PREPARING',60),
('99999999-9999-4999-8999-999999999993',3,'Battery','MAC','B1','A','','电池',1,1,1,1,'SHIPPED',60);

do $$
declare req public.pi_amendment_requests; blocked boolean; proposal jsonb;
  received_line jsonb := jsonb_build_object('id','99999999-9999-4999-8999-999999999995',
    'item_name','LCD','brand','MAC','model','A2338','quality','A','description','',
    'description_zh','屏幕','quantity',2,'unit_price_cny',100,'estimated_unit_cost_cny',60);
  shipped_line jsonb := jsonb_build_object('id','99999999-9999-4999-8999-999999999996',
    'item_name','Battery','brand','MAC','model','B1','quality','A','description','',
    'description_zh','电池','quantity',1,'unit_price_cny',100,'estimated_unit_cost_cny',60);
begin
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
  proposal := jsonb_build_array(received_line,shipped_line);
  req := public.request_direct_pi_amendment(
    '99999999-9999-4999-8999-999999999992',1,proposal,'customer removes unreceived cable');
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888882',true);
  perform public.decide_direct_pi_amendment(req.id,true,'confirmed no cable received');
  if not exists(select 1 from public.stock_order_items
      where stock_order_id='99999999-9999-4999-8999-999999999993' and line_number=1
        and quantity=0 and pi_amendment_cancelled_at is not null)
    or not exists(select 1 from public.sales_order_items
      where sales_order_id='99999999-9999-4999-8999-999999999992' and line_number=1
        and quantity=0 and pi_amendment_cancelled_at is not null)
    or (select subtotal_cny from public.sales_orders
      where id='99999999-9999-4999-8999-999999999992')<>300 then
    raise exception 'unreceived deletion did not synchronize all documents';
  end if;
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
  proposal := jsonb_build_array(jsonb_set(received_line,'{quality}','"B"'::jsonb),shipped_line);
  req := public.request_direct_pi_amendment(
    '99999999-9999-4999-8999-999999999992',2,proposal,'customer wants different quality');
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888882',true);
  blocked := false;
  begin perform public.decide_direct_pi_amendment(req.id,true,'physical return not recorded');
  exception when others then blocked:=true; end;
  if not blocked or (select status from public.pi_amendment_requests where id=req.id)<>'PENDING' then
    raise exception 'received product identity was changed without physical reconciliation';
  end if;
  perform public.decide_direct_pi_amendment(req.id,false,'return or reallocation required');
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
  proposal := jsonb_build_array(received_line,jsonb_set(shipped_line,'{quantity}','2'::jsonb));
  blocked := false;
  begin perform public.request_direct_pi_amendment(
    '99999999-9999-4999-8999-999999999992',2,proposal,'increase already shipped battery');
  exception when others then blocked:=true; end;
  if not blocked then raise exception 'partially shipped product could be amended'; end if;
  -- The current PI form and import template leave the warehouse Chinese
  -- description optional. An otherwise valid new line must not be rejected.
  proposal := jsonb_build_array(received_line, shipped_line,
    jsonb_build_object('id','99999999-9999-4999-8999-999999999997',
      'item_name','Adapter','brand','MAC','model','A1','quality','A',
      'description','','description_zh','','quantity',1,
      'unit_price_cny',80,'estimated_unit_cost_cny',40));
  req := public.request_direct_pi_amendment(
    '99999999-9999-4999-8999-999999999992',2,proposal,
    'customer adds adapter without optional Chinese description');
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888882',true);
  perform public.decide_direct_pi_amendment(req.id,true,'new adapter has no received goods');
  if not exists(select 1 from public.sales_order_items
      where id='99999999-9999-4999-8999-999999999997'
        and coalesce(description_zh,'')='') then
    raise exception 'optional Chinese description incorrectly blocked PI change';
  end if;
end $$;

do $$
declare req public.pi_amendment_requests; blocked boolean; next_quantity integer;
  proposal jsonb;
begin
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
  proposal:=jsonb_build_array(
    jsonb_build_object('id','88888888-8888-4888-8888-888888888886','item_name','LCD',
      'brand','MAC','model','A2338','quality','Original','description','screen',
      'description_zh','原装屏','quantity',2,'unit_price_cny',100,'estimated_unit_cost_cny',60),
    jsonb_build_object('id','88888888-8888-4888-8888-888888888889','item_name','Cable',
      'brand','MAC','model','C1','quality','Original','description','',
      'description_zh','数据线','quantity',2,'unit_price_cny',50,'estimated_unit_cost_cny',20));
  req:=public.request_direct_pi_amendment(
    '88888888-8888-4888-8888-888888888885',3,proposal,'customer requests below received quantity');
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888882',true);
  blocked:=false;
  begin perform public.decide_direct_pi_amendment(req.id,true,'unsafe quantity reduction');
  exception when others then blocked:=true; end;
  if not blocked or (select status from public.pi_amendment_requests where id=req.id)<>'PENDING'
    or (select quantity from public.stock_order_items
      where id='88888888-8888-4888-8888-888888888888')<>12 then
    raise exception 'unsafe approval did not roll back atomically'; end if;
  perform public.decide_direct_pi_amendment(req.id,false,'实物已回货，需先由仓库冲正');
  if (select count(*) from public.pi_amendment_requests
    where sales_order_id='88888888-8888-4888-8888-888888888885' and status='APPLIED')<>1 then
    raise exception 'rejected request consumed amendment allowance'; end if;
  for next_quantity in 13..14 loop
    perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
    proposal:=jsonb_set(proposal,'{0,quantity}',to_jsonb(next_quantity));
    req:=public.request_direct_pi_amendment(
      '88888888-8888-4888-8888-888888888885',next_quantity-10,proposal,'customer adds units');
    perform set_config('test.actor_id','88888888-8888-4888-8888-888888888882',true);
    perform public.decide_direct_pi_amendment(req.id,true,'warehouse confirmed');
  end loop;
  perform set_config('test.actor_id','88888888-8888-4888-8888-888888888881',true);
  proposal:=jsonb_set(proposal,'{0,quantity}','15'::jsonb);
  blocked:=false;
  begin perform public.request_direct_pi_amendment(
    '88888888-8888-4888-8888-888888888885',5,proposal,'fourth change');
  exception when others then blocked:=true; end;
  if not blocked or (select count(*) from public.pi_amendment_requests
    where sales_order_id='88888888-8888-4888-8888-888888888885' and status='APPLIED')<>3 then
    raise exception 'fourth post-start amendment was not blocked'; end if;
end $$;
