-- Execute this entire file as one SQL request. All fixtures are rolled back.
begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('90000000-0000-4000-8000-000000000131','codex-fee-rollback-20261019@example.invalid','{}');
update public.users set status='ACTIVE',role='SALES'
  where id='90000000-0000-4000-8000-000000000131';
insert into public.profiles(id,name,email,phone) values
  ('90000000-0000-4000-8000-000000000131','Rollback Fee Sales','codex-fee-rollback-20261019@example.invalid','+86 13800000031');
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via,
  phone,email,manual_grade,shipping_address)
values('90000000-0000-4000-8000-000000000231','CODEX-ROLLBACK-FEE-CUSTOMER-20261019','GB','CLAIMED','CLAIMED',
  '90000000-0000-4000-8000-000000000131','90000000-0000-4000-8000-000000000131',
  '90000000-0000-4000-8000-000000000131','PRIVATE_CREATE',
  '+44 123456789','codex-fee-buyer-rollback-20261019@example.invalid','A','Rollback delivery address');
insert into public.pi_payment_accounts(id,label,currency,instructions,payment_channel)
values('90000000-0000-4000-8000-000000000331','CODEX-ROLLBACK-PAYPAL-20261019','USD','Rollback-only PayPal account','PayPal');

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000131',true);

do $$
declare
  pi public.sales_orders;
  stock public.stock_orders;
begin
  pi := public.create_direct_pi_order_with_fees(
    '90000000-0000-4000-8000-000000000231','CODEX-ROLLBACK-FEE-20261019','USD',0.1,20,
    'PayPal','90000000-0000-4000-8000-000000000331',current_date+30,current_date+14,
    'Rollback Buyer','+44 123456789','codex-fee-buyer-rollback-20261019@example.invalid','Rollback delivery address',
    'Rollback preparation requirements',
    '[{"item_name":"LCD","brand":"IPH","model":"Rollback Fee","quality":"OLED","description_zh":"测试屏幕","quantity":1,"unit_price_cny":100,"unit_price_payment":10,"unit_price_source":"CNY","estimated_unit_cost_cny":80}]'::jsonb,
    '{"last_balance":{"source":"CNY","amount":"50"},"discount":{"source":"PAYMENT","amount":"5"},"other":{"source":"CNY","amount":"30"},"paypal_rate_percent":"5"}'::jsonb,
    '90000000-0000-4000-8000-000000000131');
  if pi.status <> 'DRAFT' or pi.payment_method <> 'PayPal'
    or pi.subtotal_cny <> 100 or pi.subtotal <> 10
    or pi.shipping_cny <> 20 or pi.shipping_cost <> 2
    or pi.last_balance_cny <> 50 or pi.last_balance_amount <> 5 or pi.last_balance_source <> 'CNY'
    or pi.discount_cny <> 50 or pi.discount_amount <> 5 or pi.discount_source <> 'PAYMENT'
    or pi.other_charge_cny <> 30 or pi.other_charge_amount <> 3 or pi.other_charge_source <> 'CNY'
    or pi.paypal_fee_percent <> 5 or pi.paypal_fee_cny <> 7.5 or pi.paypal_fee_amount <> 0.75
    or pi.total_cny <> 157.5 or pi.total_amount <> 15.75 then
    raise exception 'PI PayPal fee sign, currency conversion or total mismatch';
  end if;

  pi := public.submit_direct_pi_order(pi.id,pi.pi_revision);
  select * into stock from public.stock_orders where sales_order_id=pi.id;
  if pi.status <> 'WAITING_STOCK' or stock.status <> 'WAITING'
    or stock.sales_order_id <> pi.id
    or not exists (select 1 from public.sales_orders submitted
      where submitted.id=stock.sales_order_id and submitted.total_cny=157.5 and submitted.total_amount=15.75)
    then
    raise exception 'Submitted PI fee totals or stock-order linkage mismatch';
  end if;
end $$;

rollback;
