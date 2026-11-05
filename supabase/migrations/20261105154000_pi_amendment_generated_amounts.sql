-- PI/quote line amounts are generated as quantity * unit_price.  The amendment
-- transaction must update their inputs, never write the generated column.
do $migration$
declare
  definition text;
  amount_expression constant text := 'round(candidate.unit_price_cny*target.fx_rate_cny_to_payment,2)*candidate.quantity,';
begin
  select pg_get_functiondef('public.decide_direct_pi_amendment(uuid,boolean,text)'::regprocedure)
    into definition;
  if definition is null
    or (length(definition)-length(replace(definition,'amount=0,','')))/length('amount=0,') <> 2
    or (length(definition)-length(replace(definition,'amount='||amount_expression,'')))/length('amount='||amount_expression) <> 2
    or (length(definition)-length(replace(definition,'unit_price_cny,amount,','')))/length('unit_price_cny,amount,') <> 2 then
    raise exception 'PI amendment function differs from the expected version; no change applied';
  end if;

  definition := replace(definition, 'amount=0,', '');
  definition := replace(definition, 'amount='||amount_expression, '');
  definition := replace(definition, 'unit_price_cny,amount,', 'unit_price_cny,');
  if (length(definition)-length(replace(definition,amount_expression,'')))/length(amount_expression) <> 2 then
    raise exception 'PI amendment insert values differ from the expected version; no change applied';
  end if;
  definition := replace(definition, amount_expression, '');
  execute definition;
end;
$migration$;

