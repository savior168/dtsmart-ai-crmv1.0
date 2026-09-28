-- Run only in the isolated Supabase test project after product migrations.
-- This verifies manual SKU creation, alias lookup, traceable price versions,
-- and complete CNY cost. All fixture writes are rolled back.
begin;
do $$
declare
  actor_id uuid := '00000000-0000-4000-8000-000000000001';
  category_id uuid;
  v_product_id uuid;
  generated_sku text;
  total_cost numeric;
begin
  if not exists (select 1 from public.users where id=actor_id and role='ADMIN' and status='ACTIVE') then
    raise exception 'Isolated test administrator fixture missing';
  end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  insert into public.product_categories(code,name_zh,product_family,created_by)
  values('TEST-MANUAL-ROLLBACK','测试手工建档（回滚）','SCREEN',actor_id)
  returning id into category_id;
  insert into public.products(category_id,name_zh,brand,model,aliases,created_by,updated_by)
  values(category_id,'测试屏幕（回滚）','iPhone','17',array['TEST_ALIAS_0928'],actor_id,actor_id)
  returning id,sku into v_product_id,generated_sku;
  if generated_sku not like 'ZK-%' then raise exception 'SKU was not generated: %',generated_sku; end if;
  if (select count(*) from public.find_product_alias_ids('ALIAS_0928'))<>1 then
    raise exception 'Alias lookup failed';
  end if;
  begin
    perform public.save_product_price(v_product_id,'PROCUREMENT','CNY',80,1,current_date,'');
    raise exception 'Empty source was accepted';
  exception when others then
    if position('请填写' in sqlerrm)=0 then raise; end if;
  end;
  perform public.save_product_price(v_product_id,'PROCUREMENT','CNY',80,1,current_date,'TEST supplier quote');
  perform public.save_product_price(v_product_id,'PACKAGING','CNY',2,1,current_date,'TEST packing quote');
  perform public.save_product_price(v_product_id,'OTHER_COST','CNY',0,1,current_date,'TEST other cost confirmed zero');
  select public.product_cost_at_quantity(v_product_id,1) into total_cost;
  if total_cost<>82 then raise exception 'Wrong total cost: %',total_cost; end if;
  perform public.save_product_price(v_product_id,'PROCUREMENT','CNY',81,1,current_date,'TEST price revision');
  if (select count(*) from public.product_prices pp
      where pp.product_id=v_product_id and pp.price_kind='PROCUREMENT' and pp.is_active)<>1 then
    raise exception 'Price versioning failed';
  end if;
end $$;
rollback;
