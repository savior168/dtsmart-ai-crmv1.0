-- Require a traceable source for each new manual price version. Historical
-- prices remain unchanged, including records created before this guard.
begin;

create or replace function public.save_product_price(
  p_product_id uuid,p_price_kind text,p_currency text,p_amount numeric,
  p_minimum_quantity numeric,p_effective_from date,p_source_note text
) returns public.product_prices
language plpgsql security definer set search_path=public as $$
declare actor public.users; saved public.product_prices;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.manage') then raise exception '无产品价格维护权限'; end if;
  if p_price_kind is null or p_price_kind not in ('PROCUREMENT','PACKAGING','OTHER_COST','SALE_REFERENCE')
    or p_currency is distinct from (case when p_price_kind='SALE_REFERENCE' then 'USD' else 'CNY' end)
  then raise exception '价格类型或币种无效'; end if;
  if p_product_id is null or p_effective_from is null or p_amount is null or p_minimum_quantity is null
    or p_amount<0 or p_amount>=100000000000000
    or p_minimum_quantity<=0 or p_minimum_quantity>=100000000000
    or p_amount<>round(p_amount,4) or p_minimum_quantity<>round(p_minimum_quantity,3)
  then raise exception '商品、金额、起订量或生效日期无效'; end if;
  if nullif(btrim(coalesce(p_source_note,'')),'') is null or length(btrim(p_source_note))>500
  then raise exception '请填写不超过500字的价格来源或调整说明'; end if;
  if p_effective_from>current_date then raise exception '暂不支持预约生效价格，请在生效当天维护'; end if;
  perform pg_advisory_xact_lock(hashtext(p_product_id::text));
  update public.product_prices set is_active=false,effective_to=greatest(effective_from,p_effective_from),updated_at=now()
  where product_id=p_product_id and price_kind=p_price_kind and currency=p_currency and minimum_quantity=p_minimum_quantity and is_active;
  insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,effective_from,source_note,created_by)
  values(p_product_id,p_price_kind,p_currency,p_amount,p_minimum_quantity,p_effective_from,btrim(p_source_note),actor.id)
  returning * into saved;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PRODUCT_PRICE_CREATE','product_price',saved.id,jsonb_build_object('product_id',p_product_id,'price_kind',p_price_kind,'currency',p_currency,'amount',p_amount,'minimum_quantity',p_minimum_quantity));
  return saved;
end $$;

commit;
