-- A commercial price correction does not change the warehouse's physical
-- fulfillment or the independently verified actual/purchase cost.
do $$
declare
  definition text;
  changed text;
begin
  definition := pg_get_functiondef('public.correct_direct_pi_line_prices(uuid,uuid,integer,numeric,numeric,numeric,numeric,text)'::regprocedure);
  if position('or target.status in (''DRAFT'',''CANCELLED'',''SHIPPED'')' in definition) = 0
    or position('or stock.status in (''DRAFT'',''CANCELLED'',''SHIPPED'')' in definition) = 0
    or position('or stock_line.shipped_quantity>0' in definition) = 0 then
    raise exception 'correct_direct_pi_line_prices shipped-price guard drifted';
  end if;
  changed := replace(definition,
    'or target.status in (''DRAFT'',''CANCELLED'',''SHIPPED'')',
    'or target.status in (''DRAFT'',''CANCELLED'')');
  changed := replace(changed,
    'or stock.status in (''DRAFT'',''CANCELLED'',''SHIPPED'')',
    'or stock.status in (''DRAFT'',''CANCELLED'')');
  changed := replace(changed,
    'or stock_line.shipped_quantity>0',
    '');
  changed := replace(changed,
    '产品已交货代或价格已变化，请刷新后核对',
    '产品价格已变化，请刷新后核对');
  if position('or target.status in (''DRAFT'',''CANCELLED'',''SHIPPED'')' in changed) > 0
    or position('or stock.status in (''DRAFT'',''CANCELLED'',''SHIPPED'')' in changed) > 0
    or position('or stock_line.shipped_quantity>0' in changed) > 0 then
    raise exception 'correct_direct_pi_line_prices shipped-price guard drifted';
  end if;
  execute changed;
end $$;
