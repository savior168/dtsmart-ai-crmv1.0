begin;

-- Return all raw country groups; the API merges aliases such as IE and
-- 爱尔兰 before selecting the actual top ten. Keep all other RPC behavior.
do $$
declare
  definition text;
  previous_grouping text := 'from filtered_customers group by 1 order by count desc,name limit 10';
  all_groups text := 'from filtered_customers group by 1';
begin
  select pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz,uuid,text,text)'::regprocedure)
    into definition;
  if definition is null then
    raise exception 'dashboard_overview function does not exist';
  end if;
  if position(previous_grouping in definition) = 0 then
    if position(all_groups in definition) > 0 then
      return;
    end if;
    raise exception 'dashboard_overview country grouping was not found';
  end if;
  execute replace(definition, previous_grouping, all_groups);
end;
$$;

commit;
