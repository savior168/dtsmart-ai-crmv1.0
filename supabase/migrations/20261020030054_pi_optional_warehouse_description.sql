-- Allow PI lines without either optional description; preserve all other validation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  signature text;
  definition text;
  old_guard text := 'or nullif(trim(coalesce(x.description_zh,'''')),'''') is null';
  old_error text;
begin
  foreach signature in array array[
    'public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)',
    'public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    old_error := case when signature like '%update_direct_pi_draft%' then '和仓库中文规格' else '和仓库用中文规格' end;
    if position(old_guard in definition) = 0 or position(old_error in definition) = 0 then
      raise exception 'PI description validation changed; review % before applying', signature;
    end if;
    definition := replace(definition, old_guard, '');
    definition := replace(definition, old_error, '');
    execute definition;
  end loop;
end $$;

commit;
