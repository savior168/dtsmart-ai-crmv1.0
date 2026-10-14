-- Keep direct RPC writes consistent with PI form/API mandatory line fields.
-- This migration changes validation only; it does not rewrite existing orders.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  signature text;
  definition text;
  old_record text := 'as x(item_name text,quantity numeric,unit_price_cny numeric,' || chr(10) || '    estimated_unit_cost_cny numeric,description_zh text)';
  new_record text := 'as x(item_name text,brand text,model text,quality text,quantity numeric,unit_price_cny numeric,' || chr(10) || '    estimated_unit_cost_cny numeric,description_zh text)';
  old_guard text := 'where nullif(trim(coalesce(x.item_name,'''')),'''') is null or x.quantity is null';
  new_guard text := 'where nullif(trim(coalesce(x.item_name,'''')),'''') is null' || chr(10) ||
    '      or nullif(trim(coalesce(x.brand,'''')),'''') is null' || chr(10) ||
    '      or nullif(trim(coalesce(x.model,'''')),'''') is null' || chr(10) ||
    '      or nullif(trim(coalesce(x.quality,'''')),'''') is null or x.quantity is null';
begin
  foreach signature in array array[
    'public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(old_record in definition) = 0 or position(old_guard in definition) = 0 then
      raise exception 'PI function validation changed; review % before applying', signature;
    end if;
    definition := replace(definition, old_record, new_record);
    definition := replace(definition, old_guard, new_guard);
    execute definition;
  end loop;
end $$;

commit;
