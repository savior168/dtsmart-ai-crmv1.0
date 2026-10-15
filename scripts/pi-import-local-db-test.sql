-- Run only against a disposable local database with PI migrations applied.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000111','import-sales-a@example.invalid','{}'),
  ('00000000-0000-0000-0000-000000000112','import-sales-b@example.invalid','{}');
update public.users set status='ACTIVE',role='SALES' where id in
  ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000112');
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via)
values('00000000-0000-0000-0000-000000000211','Import Buyer','GB','CLAIMED','CLAIMED',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000000111','PRIVATE_CREATE');
insert into public.pi_payment_accounts(id,label,currency,instructions)
values('00000000-0000-0000-0000-000000000311','Local import account','USD','Test account only');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000111',true);
do $$
declare imported public.pi_import_drafts; rejected boolean:=false;
begin
  imported:=public.create_pi_import_draft('customer-pi.xlsx','PI-USD',
    '{"warehouse_reference_number":"D60020733","currency":"USD","items":[{"item_name":"LCD","brand":"IPH","model":"IP 17 Pro","quality":"OLED","quantity":1,"unit_price_payment":41.64}],"shipping_payment":0}'::jsonb);
  if imported.status<>'PENDING' or imported.owner_id<>auth.uid()
    or (select count(*) from public.sales_orders where warehouse_reference_number='D60020733')<>0
    or (select count(*) from public.stock_orders where warehouse_reference_number='D60020733')<>0 then
    raise exception '导入只能生成本人待补全记录，不能生成PI或备货单';
  end if;
  perform set_config('test.import_id',imported.id::text,true);
  begin
    perform public.convert_pi_import_draft(imported.id,0,
      '00000000-0000-0000-0000-000000000211','D60020733','USD',0.1388,0,
      'T/T Bank Transfer','00000000-0000-0000-0000-000000000311',current_date+5,null,
      null,null,null,null,'常规理货',
      '[{"item_name":"LCD","brand":"IPH","model":"IP 17 Pro","quality":"OLED","description_zh":"LCD / IPH / IP 17 Pro / OLED","quantity":1,"unit_price_cny":300,"estimated_unit_cost_cny":260}]'::jsonb);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '过期导入版本不得转换'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000112',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.delete_pi_import_draft(current_setting('test.import_id')::uuid,1);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '其他销售员不得删除导入草稿'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000111',true);
do $$
declare created public.sales_orders; rejected boolean:=false;
begin
  created:=public.convert_pi_import_draft(current_setting('test.import_id')::uuid,1,
    '00000000-0000-0000-0000-000000000211','D60020733','USD',0.1388,0,
    'T/T Bank Transfer','00000000-0000-0000-0000-000000000311',current_date+5,null,
    null,null,null,null,'常规理货',
    '[{"item_name":"LCD","brand":"IPH","model":"IP 17 Pro","quality":"OLED","description_zh":"LCD / IPH / IP 17 Pro / OLED","quantity":1,"unit_price_cny":300,"estimated_unit_cost_cny":260}]'::jsonb);
  if created.status<>'DRAFT' or created.pi_source<>'EXCEL_IMPORT'
    or (select status from public.pi_import_drafts where id=current_setting('test.import_id')::uuid)<>'CONVERTED'
    or (select count(*) from public.stock_orders where sales_order_id=created.id)<>0 then
    raise exception '补全后只生成PI草稿，不得自动生成备货单';
  end if;
  begin
    perform public.convert_pi_import_draft(current_setting('test.import_id')::uuid,1,
      '00000000-0000-0000-0000-000000000211','D60020733','USD',0.1388,0,
      'T/T Bank Transfer','00000000-0000-0000-0000-000000000311',current_date+5,null,
      null,null,null,null,'常规理货',
      '[{"item_name":"LCD","brand":"IPH","model":"IP 17 Pro","quality":"OLED","description_zh":"LCD / IPH / IP 17 Pro / OLED","quantity":1,"unit_price_cny":300,"estimated_unit_cost_cny":260}]'::jsonb);
  exception when others then rejected:=true; end;
  if not rejected then raise exception '已转换导入草稿不得重复生成PI'; end if;
end $$;

rollback;
