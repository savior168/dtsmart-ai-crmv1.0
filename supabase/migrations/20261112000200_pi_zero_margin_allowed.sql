-- Allow nonnegative PI selling prices and costs without rewriting existing PI rows.
-- Existing PI rows are not rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  signature text;
  definition text;
  old_guard text := 'or x.unit_price_cny<=x.estimated_unit_cost_cny';
  new_guard text := '';
begin
  foreach signature in array array[
    'public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(old_guard in definition) = 0 then
      raise exception 'PI margin guard changed; review % before applying', signature;
    end if;
    execute replace(definition, old_guard, new_guard);
  end loop;
end $$;

do $$
declare
  definition text;
  old_guard text := 'or i.unit_price_cny<=i.estimated_unit_cost_cny';
  new_guard text := '';
  old_message text := 'PI商品售价必须高于成本价，请返回草稿核对';
  new_message text := 'PI商品售价或成本未填写，请返回草稿核对';
begin
  definition := pg_get_functiondef('public.guard_direct_pi_submit_margin()'::regprocedure);
  if position(old_guard in definition) = 0 or position(old_message in definition) = 0 then
    raise exception 'PI submit margin guard changed; review before applying';
  end if;
  definition := replace(definition, old_guard, new_guard);
  definition := replace(definition, old_message, new_message);
  if position(old_guard in definition) > 0 or position(old_message in definition) > 0 then
    raise exception 'PI submit margin guard replacement incomplete; review before applying';
  end if;
  execute definition;
end $$;

commit;
