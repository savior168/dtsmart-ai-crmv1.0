begin;
set local lock_timeout = '5s';

-- amount is GENERATED ALWAYS AS (quantity * unit_price) on both PI line
-- tables. Updating the price automatically recalculates it.
do $$
declare
  definition text;
  previous text;
begin
  definition := pg_get_functiondef('public.apply_direct_pi_unit_prices(uuid,jsonb)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'amount = round(qi.quantity * input.unit_price_payment, 2),',
    '');
  if definition = previous then
    raise exception 'PI quote line generated amount assignment changed; review migration';
  end if;

  previous := definition;
  definition := replace(definition,
    'unit_price = qi.unit_price, amount = qi.amount, unit_price_source = qi.unit_price_source',
    'unit_price = qi.unit_price, unit_price_source = qi.unit_price_source');
  if definition = previous then
    raise exception 'PI order line generated amount assignment changed; review migration';
  end if;
  execute definition;
end $$;

commit;
