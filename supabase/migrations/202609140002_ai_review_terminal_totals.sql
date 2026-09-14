begin;

-- A REVIEW result is a completed analysis that requires human judgement; it
-- is not a pending execution item.  Treating it as pending kept completed
-- tasks in RUNNING and allowed the stale-task rescuer to restart them.
do $$
declare
  definition text;
  previous_terminal_test text := 'target_decision in (''VALID'',''INVALID'')';
  terminal_test text := 'target_decision in (''VALID'',''INVALID'',''REVIEW'')';
begin
  select pg_get_functiondef('public.refresh_ai_screening_task_totals(uuid)'::regprocedure)
    into definition;
  if definition is null then
    raise exception 'refresh_ai_screening_task_totals function does not exist';
  end if;
  if position(previous_terminal_test in definition) = 0 then
    raise exception 'task terminal-result predicate was not found';
  end if;
  execute replace(definition, previous_terminal_test, terminal_test);
end;
$$;

commit;
