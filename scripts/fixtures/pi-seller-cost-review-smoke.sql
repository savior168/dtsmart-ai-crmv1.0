-- Run only after supplier-ledger-bootstrap.sql and pi-shipped-line-guard-smoke.sql
-- on a fresh isolated PostgreSQL fixture.
alter table public.sales_orders
  add column sales_user_id uuid,
  add column prepared_by uuid,
  add column confirmation_method text,
  add column status text;
set test.actor_id = '77777777-7777-4777-8777-777777777771';
insert into public.users(id,role,status)
values ('77777777-7777-4777-8777-777777777771','SALES','ACTIVE'),
  ('77777777-7777-4777-8777-777777777772','SALES','ACTIVE'),
  ('77777777-7777-4777-8777-777777777782','SUPERVISOR','ACTIVE'),
  ('77777777-7777-4777-8777-777777777783','ADMIN','ACTIVE');
insert into public.sales_orders(id,order_number,sales_user_id,confirmation_method,status)
values ('77777777-7777-4777-8777-777777777773','PI-COST-REVIEW',
  '77777777-7777-4777-8777-777777777771','DIRECT_PI','PREPARING');
insert into public.sales_order_items(id,sales_order_id,line_number,estimated_unit_cost_cny)
values ('77777777-7777-4777-8777-777777777774',
  '77777777-7777-4777-8777-777777777773',1,100.00);
insert into public.stock_orders(id,sales_order_id,status)
values ('77777777-7777-4777-8777-777777777775',
  '77777777-7777-4777-8777-777777777773','PREPARING');
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,quantity,
  received_quantity,prepared_quantity,shipped_quantity,estimated_unit_cost_cny)
values ('77777777-7777-4777-8777-777777777776',
  '77777777-7777-4777-8777-777777777775',1,'Shipped product',5,5,5,0,100.00);

do $$
declare blocked boolean; reviewer record;
begin
  if has_table_privilege('authenticated','public.pi_seller_cost_reviews','SELECT')
    or has_table_privilege('authenticated','public.pi_seller_cost_reviews','INSERT')
    or not has_table_privilege('service_role','public.pi_seller_cost_reviews','SELECT') then
    raise exception 'seller cost audit table privileges are unsafe';
  end if;
  blocked := false;
  begin
    perform public.review_shipped_pi_seller_cost(
      '77777777-7777-4777-8777-777777777773',
      '77777777-7777-4777-8777-777777777774',100,150,'purchase price increased');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'seller cost changed before entire shipment'; end if;
  update public.stock_order_items set shipped_quantity=5
    where id='77777777-7777-4777-8777-777777777776';
  update public.stock_orders set status='SHIPPED'
    where id='77777777-7777-4777-8777-777777777775';
  if (select count(*) from public.system_notifications
      where recipient_id='77777777-7777-4777-8777-777777777771'
        and dedupe_key='pi-seller-cost-review:77777777-7777-4777-8777-777777777773') <> 1 then
    raise exception 'full shipment did not create one seller cost review reminder';
  end if;
  update public.sales_orders set status='SHIPPED'
    where id='77777777-7777-4777-8777-777777777773';
  perform set_config('test.actor_id','77777777-7777-4777-8777-777777777772',true);
  blocked := false;
  begin
    perform public.review_shipped_pi_seller_cost(
      '77777777-7777-4777-8777-777777777773',
      '77777777-7777-4777-8777-777777777774',100,150,'not my PI');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'another sales user changed owner cost'; end if;
  for reviewer in select id from public.users where role in ('SUPERVISOR','ADMIN') loop
    perform set_config('test.actor_id',reviewer.id::text,true);
    blocked := false;
    begin
      perform public.review_shipped_pi_seller_cost(
        '77777777-7777-4777-8777-777777777773',
        '77777777-7777-4777-8777-777777777774',100,150,'cross-user privileged review');
    exception when others then blocked := true; end;
    if not blocked then raise exception 'supervisor or admin changed another creator PI'; end if;
  end loop;
  perform set_config('test.actor_id','77777777-7777-4777-8777-777777777771',true);
  perform public.review_shipped_pi_seller_cost(
    '77777777-7777-4777-8777-777777777773',
    '77777777-7777-4777-8777-777777777774',100,150,'purchase price increased');
  blocked := false;
  begin
    perform public.review_shipped_pi_seller_cost(
      '77777777-7777-4777-8777-777777777773',
      '77777777-7777-4777-8777-777777777774',100,160,'stale client');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'stale cost overwrote current cost'; end if;
  perform public.review_shipped_pi_seller_cost(
    '77777777-7777-4777-8777-777777777773',
    '77777777-7777-4777-8777-777777777774',150,160,'second documented correction');
  if (select estimated_unit_cost_cny from public.sales_order_items
      where id='77777777-7777-4777-8777-777777777774') <> 160
    or (select estimated_unit_cost_cny from public.stock_order_items
      where id='77777777-7777-4777-8777-777777777776') <> 100
    or (select count(*) from public.pi_seller_cost_reviews
      where sales_order_id='77777777-7777-4777-8777-777777777773') <> 2
    or (select count(*) from public.audit_logs
      where action='PI_SELLER_COST_REVIEW') <> 2 then
    raise exception 'seller cost reviews failed to update estimate only and retain audit trail';
  end if;
  insert into public.users(id,role,status)
  values('77777777-7777-4777-8777-777777777777','ORDER_CLERK','ACTIVE');
  insert into public.sales_orders(id,order_number,sales_user_id,prepared_by,confirmation_method,status)
  values('77777777-7777-4777-8777-777777777778','PI-CLERK-COST',
    '77777777-7777-4777-8777-777777777771',
    '77777777-7777-4777-8777-777777777777','DIRECT_PI','SHIPPED');
  insert into public.sales_order_items(id,sales_order_id,line_number,estimated_unit_cost_cny)
  values('77777777-7777-4777-8777-777777777779',
    '77777777-7777-4777-8777-777777777778',1,20);
  insert into public.stock_orders(id,sales_order_id,status)
  values('77777777-7777-4777-8777-777777777780',
    '77777777-7777-4777-8777-777777777778','SHIPPED');
  insert into public.stock_order_items(id,stock_order_id,line_number,item_name,quantity,
    received_quantity,prepared_quantity,shipped_quantity)
  values('77777777-7777-4777-8777-777777777781',
    '77777777-7777-4777-8777-777777777780',1,'Clerk product',2,2,2,2);
  blocked := false;
  begin
    perform public.review_shipped_pi_seller_cost(
      '77777777-7777-4777-8777-777777777778',
      '77777777-7777-4777-8777-777777777779',20,21,'sales owner did not prepare this PI');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'sales owner changed a clerk-created PI'; end if;
  perform set_config('test.actor_id','77777777-7777-4777-8777-777777777777',true);
  perform public.review_shipped_pi_seller_cost(
    '77777777-7777-4777-8777-777777777778',
    '77777777-7777-4777-8777-777777777779',20,21,'clerk checked selling estimate');
  if (select estimated_unit_cost_cny from public.sales_order_items
      where id='77777777-7777-4777-8777-777777777779') <> 21 then
    raise exception 'PI creator clerk could not review own submitted cost';
  end if;
end $$;
