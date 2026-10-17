-- Execute as one request. The role, customer and PI fixtures are rolled back.
begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('90000000-0000-4000-8000-000000000121','codex-owner-rollback-20261017@example.invalid','{}'),
  ('90000000-0000-4000-8000-000000000122','codex-other-sales-rollback-20261017@example.invalid','{}'),
  ('90000000-0000-4000-8000-000000000123','codex-clerk-rollback-20261017@example.invalid','{}'),
  ('90000000-0000-4000-8000-000000000124','codex-other-clerk-rollback-20261017@example.invalid','{}'),
  ('90000000-0000-4000-8000-000000000125','codex-supervisor-rollback-20261017@example.invalid','{}');
update public.users set status='ACTIVE',role='SALES',name='Rollback Owner'
  where id in ('90000000-0000-4000-8000-000000000121','90000000-0000-4000-8000-000000000122');
update public.users set status='ACTIVE',role='ORDER_CLERK'
  where id in ('90000000-0000-4000-8000-000000000123','90000000-0000-4000-8000-000000000124');
update public.users set status='ACTIVE',role='SUPERVISOR',name='Rollback Supervisor'
  where id='90000000-0000-4000-8000-000000000125';
insert into public.profiles(id,name,email,phone) values
  ('90000000-0000-4000-8000-000000000121','Rollback Owner','codex-owner-rollback-20261017@example.invalid','+86 13800000021');
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via)
values('90000000-0000-4000-8000-000000000221','CODEX-ROLLBACK-CLERK-CUSTOMER-20261017','GB','CLAIMED','CLAIMED',
  '90000000-0000-4000-8000-000000000121','90000000-0000-4000-8000-000000000121',
  '90000000-0000-4000-8000-000000000121','PRIVATE_CREATE');
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via)
values('90000000-0000-4000-8000-000000000222','CODEX-ROLLBACK-SUPERVISOR-CUSTOMER-20261017','GB','CLAIMED','CLAIMED',
  '90000000-0000-4000-8000-000000000125','90000000-0000-4000-8000-000000000125',
  '90000000-0000-4000-8000-000000000125','PRIVATE_CREATE');
-- Simulate a salesperson account converted to a clerk while retaining a customer.
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via)
values('90000000-0000-4000-8000-000000000223','CODEX-ROLLBACK-FORMER-OWNER-20261017','GB','CLAIMED','CLAIMED',
  '90000000-0000-4000-8000-000000000123','90000000-0000-4000-8000-000000000123',
  '90000000-0000-4000-8000-000000000123','PRIVATE_CREATE');
insert into public.pi_payment_accounts(id,label,currency,instructions,payment_channel)
values('90000000-0000-4000-8000-000000000321','CODEX-ROLLBACK-CLERK-ACCOUNT-20261017','USD','Rollback bank details','T/T Bank Transfer');

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000123',true);

do $$
declare
  pi public.sales_orders;
  other_pi public.sales_orders;
  supervisor_pi public.sales_orders;
  rejected boolean;
begin
  rejected := false;
  begin
    perform public.create_direct_pi_order_with_fees(
      '90000000-0000-4000-8000-000000000221','CODEX-ROLLBACK-CLERK-WRONG-OWNER','USD',0.1,0,
      'T/T Bank Transfer','90000000-0000-4000-8000-000000000321',current_date+30,null,
      'Rollback Buyer','+44 123456781','clerk-buyer-rollback@example.invalid','Rollback shipping address',
      'Rollback stocking requirement',
      '[{"item_name":"LCD","brand":"IPH","model":"Rollback","quality":"OLED","description_zh":"测试屏幕","quantity":1,"unit_price_cny":50,"unit_price_payment":5,"unit_price_source":"CNY","estimated_unit_cost_cny":30}]'::jsonb,
      '{"last_balance":{"source":"CNY","amount":"0"},"discount":{"source":"CNY","amount":"0"},"other":{"source":"CNY","amount":"0"},"paypal_rate_percent":"0"}'::jsonb,
      '90000000-0000-4000-8000-000000000122');
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Clerk could assign customer to the wrong salesperson'; end if;

  pi := public.create_direct_pi_order_with_fees(
    '90000000-0000-4000-8000-000000000221','CODEX-ROLLBACK-CLERK-20261017','USD',0.1,0,
    'T/T Bank Transfer','90000000-0000-4000-8000-000000000321',current_date+30,null,
    'Rollback Buyer','+44 123456781','clerk-buyer-rollback@example.invalid','Rollback shipping address',
    'Rollback stocking requirement',
    '[{"item_name":"LCD","brand":"IPH","model":"Rollback","quality":"OLED","description_zh":"测试屏幕","quantity":1,"unit_price_cny":50,"unit_price_payment":5,"unit_price_source":"CNY","estimated_unit_cost_cny":30}]'::jsonb,
    '{"last_balance":{"source":"CNY","amount":"0"},"discount":{"source":"CNY","amount":"0"},"other":{"source":"CNY","amount":"0"},"paypal_rate_percent":"0"}'::jsonb,
    '90000000-0000-4000-8000-000000000121');
  if pi.sales_user_id <> '90000000-0000-4000-8000-000000000121'
    or pi.prepared_by <> '90000000-0000-4000-8000-000000000123'
    or pi.seller_contact_name <> 'Rollback Owner' then
    raise exception 'Clerk PI ownership or salesperson snapshot mismatch';
  end if;
  if not exists(select 1 from public.customers where id='90000000-0000-4000-8000-000000000221')
    or not exists(select 1 from public.customers where id='90000000-0000-4000-8000-000000000222') then
    raise exception 'Clerk cannot read all assigned customer owners';
  end if;
  if not exists(select 1 from public.customers where id='90000000-0000-4000-8000-000000000223') then
    raise exception 'Clerk cannot read former owned customer';
  end if;
  update public.customers set company_name='CODEX-ROLLBACK-ILLEGAL-EDIT'
    where id='90000000-0000-4000-8000-000000000223';
  if found then raise exception 'Clerk edited former owned customer directly'; end if;
  supervisor_pi := public.create_direct_pi_order_with_fees(
    '90000000-0000-4000-8000-000000000222','CODEX-ROLLBACK-SUPERVISOR-PI-20261017','USD',0.1,0,
    'T/T Bank Transfer','90000000-0000-4000-8000-000000000321',current_date+30,null,
    'Rollback Buyer','+44 123456781','clerk-buyer-rollback@example.invalid','Rollback shipping address',
    'Rollback stocking requirement',
    '[{"item_name":"LCD","brand":"IPH","model":"Rollback","quality":"OLED","description_zh":"测试屏幕","quantity":1,"unit_price_cny":50,"unit_price_payment":5,"unit_price_source":"CNY","estimated_unit_cost_cny":30}]'::jsonb,
    '{"last_balance":{"source":"CNY","amount":"0"},"discount":{"source":"CNY","amount":"0"},"other":{"source":"CNY","amount":"0"},"paypal_rate_percent":"0"}'::jsonb,
    '90000000-0000-4000-8000-000000000125');
  if supervisor_pi.sales_user_id is distinct from '90000000-0000-4000-8000-000000000125'
    or supervisor_pi.prepared_by is distinct from '90000000-0000-4000-8000-000000000123'
    or supervisor_pi.seller_contact_name is distinct from 'Rollback Supervisor' then
    raise exception 'Clerk cannot prepare PI for supervisor customer';
  end if;
  if has_function_privilege('authenticated','public.save_direct_pi_customer_text(uuid,integer,jsonb)','EXECUTE') then
    raise exception 'Retired PI English review RPC unexpectedly became callable';
  end if;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000124',true);
  if not exists(select 1 from public.sales_orders where id=pi.id)
    or not exists(select 1 from public.sales_order_items where sales_order_id=pi.id) then
    raise exception 'Another clerk cannot read all PI orders';
  end if;
  rejected := false;
  begin
    perform public.submit_direct_pi_order(pi.id,pi.pi_revision);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Another clerk submitted someone else''s PI'; end if;
  rejected := false;
  begin
    perform public.update_direct_pi_draft_with_fees(
      pi.id,pi.pi_revision,pi.warehouse_reference_number,'USD',0.1,0,
      'T/T Bank Transfer','90000000-0000-4000-8000-000000000321',current_date+30,null,
      'Rollback Buyer','+44 123456781','clerk-buyer-rollback@example.invalid','Rollback shipping address',
      'Rollback stocking requirement',
      '[{"item_name":"LCD","brand":"IPH","model":"Rollback","quality":"OLED","description_zh":"测试屏幕","quantity":1,"unit_price_cny":80,"unit_price_payment":8,"unit_price_source":"CNY","estimated_unit_cost_cny":30}]'::jsonb,
      '{"last_balance":{"source":"CNY","amount":"0"},"discount":{"source":"CNY","amount":"0"},"other":{"source":"CNY","amount":"0"},"paypal_rate_percent":"0"}'::jsonb);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Another clerk changed someone else''s PI price'; end if;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000122',true);
  if exists(select 1 from public.sales_orders where id=pi.id) then
    raise exception 'Unrelated salesperson can read the PI';
  end if;
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000121',true);
  if not exists(select 1 from public.sales_orders where id=pi.id) then
    raise exception 'Owning salesperson cannot read the PI';
  end if;
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000123',true);
  if not exists(select 1 from public.sales_orders where id=pi.id) then
    raise exception 'Preparing clerk cannot read the PI';
  end if;
  pi := public.submit_direct_pi_order(pi.id,pi.pi_revision);
  if pi.status <> 'WAITING_STOCK' then raise exception 'Preparing clerk cannot submit the PI'; end if;
  if not exists(select 1 from public.stock_orders s where s.sales_order_id=pi.id)
    or not exists(select 1 from public.stock_order_items i join public.stock_orders s on s.id=i.stock_order_id where s.sales_order_id=pi.id) then
    raise exception 'Clerk cannot read the generated stock order';
  end if;
  if not exists(select 1 from public.stock_orders_with_pi_preparer s
    where s.sales_order_id=pi.id and s.sales_user_id='90000000-0000-4000-8000-000000000121'
      and s.pi_prepared_by='90000000-0000-4000-8000-000000000123') then
    raise exception 'Stock order preparer filter does not match its PI';
  end if;
  if exists(select 1 from public.stock_orders_with_pi_preparer s
    where s.sales_order_id=pi.id and s.pi_prepared_by='90000000-0000-4000-8000-000000000124') then
    raise exception 'Stock order preparer filter matched another clerk';
  end if;
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000124',true);
  if not exists(select 1 from public.stock_orders_with_pi_preparer s
    where s.sales_order_id=pi.id and s.pi_prepared_by='90000000-0000-4000-8000-000000000123') then
    raise exception 'Other clerk cannot filter shared stock orders by PI preparer';
  end if;
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000122',true);
  if exists(select 1 from public.stock_orders_with_pi_preparer s where s.sales_order_id=pi.id) then
    raise exception 'Stock preparer view leaked another owner''s stock order to salesperson';
  end if;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000121',true);
  other_pi := public.create_direct_pi_order_with_fees(
    '90000000-0000-4000-8000-000000000221','CODEX-ROLLBACK-SALES-PI-20261017','USD',0.1,0,
    'T/T Bank Transfer','90000000-0000-4000-8000-000000000321',current_date+30,null,
    'Rollback Buyer','+44 123456781','clerk-buyer-rollback@example.invalid','Rollback shipping address',
    'Rollback stocking requirement',
    '[{"item_name":"LCD","brand":"IPH","model":"Rollback","quality":"OLED","description_zh":"测试屏幕","quantity":1,"unit_price_cny":50,"unit_price_payment":5,"unit_price_source":"CNY","estimated_unit_cost_cny":30}]'::jsonb,
    '{"last_balance":{"source":"CNY","amount":"0"},"discount":{"source":"CNY","amount":"0"},"other":{"source":"CNY","amount":"0"},"paypal_rate_percent":"0"}'::jsonb,
    '90000000-0000-4000-8000-000000000121');
  if other_pi.prepared_by is distinct from '90000000-0000-4000-8000-000000000121' then
    raise exception 'Sales-created PI preparer was not recorded';
  end if;
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000123',true);
  if not exists(select 1 from public.sales_orders where id=other_pi.id) then
    raise exception 'Clerk cannot read salesperson-created PI';
  end if;
  rejected := false;
  begin
    perform public.submit_direct_pi_order(other_pi.id,other_pi.pi_revision);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Clerk submitted salesperson-created PI'; end if;
  rejected := false;
  begin
    perform public.set_direct_pi_change_note(other_pi.id,other_pi.pi_revision,'Unauthorized change');
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Clerk edited salesperson-created PI note'; end if;
  rejected := false;
  begin
    perform public.update_direct_pi_draft_with_fees(
      other_pi.id,other_pi.pi_revision,other_pi.warehouse_reference_number,'USD',0.1,0,
      'T/T Bank Transfer','90000000-0000-4000-8000-000000000321',current_date+30,null,
      'Rollback Buyer','+44 123456781','clerk-buyer-rollback@example.invalid','Rollback shipping address',
      'Rollback stocking requirement',
      '[{"item_name":"LCD","brand":"IPH","model":"Rollback","quality":"OLED","description_zh":"测试屏幕","quantity":1,"unit_price_cny":80,"unit_price_payment":8,"unit_price_source":"CNY","estimated_unit_cost_cny":30}]'::jsonb,
      '{"last_balance":{"source":"CNY","amount":"0"},"discount":{"source":"CNY","amount":"0"},"other":{"source":"CNY","amount":"0"},"paypal_rate_percent":"0"}'::jsonb);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Clerk changed salesperson-created PI price'; end if;
end $$;

rollback;
