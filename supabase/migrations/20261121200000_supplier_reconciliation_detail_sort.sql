begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Keep the existing checked report RPCs intact for older clients. Sort the
-- complete matching set before limit/offset; summary totals remain unchanged.
do $$
declare source_name text; target_name text; signature regprocedure; definition text;
  old_order text := 'from (select * from matching_notes order by document_date desc,id desc';
  new_order text := $order$from (select * from matching_notes order by
          case when p_sort='document_date' and p_direction='asc' then document_date end asc,
          case when p_sort='document_date' and p_direction='desc' then document_date end desc,
          case when p_sort='supplier_code' and p_direction='asc' then system_code end asc,
          case when p_sort='supplier_code' and p_direction='desc' then system_code end desc,
          case when p_sort='note_number' and p_direction='asc' then note_number end asc,
          case when p_sort='note_number' and p_direction='desc' then note_number end desc,
          case when p_sort='quantity' and p_direction='asc' then allocated_quantity end asc,
          case when p_sort='quantity' and p_direction='desc' then allocated_quantity end desc,
          case when p_sort='due' and p_direction='asc' then allocated_cny end asc,
          case when p_sort='due' and p_direction='desc' then allocated_cny end desc,
          case when p_sort='paid' and p_direction='asc' then paid_cny end asc,
          case when p_sort='paid' and p_direction='desc' then paid_cny end desc,
          case when p_sort='unpaid' and p_direction='asc' then allocated_cny-paid_cny end asc,
          case when p_sort='unpaid' and p_direction='desc' then allocated_cny-paid_cny end desc,
          document_date desc,id desc$order$;
begin
  foreach signature in array array[
    'public.supplier_reconciliation_report_checked(date,date,uuid,integer,integer,text,text)'::regprocedure,
    'public.supplier_reconciliation_report_search_checked(date,date,uuid,integer,integer,text,text,text)'::regprocedure
  ] loop
    select proname into source_name from pg_proc where oid=signature;
    target_name:=source_name||'_sorted';
    definition:=pg_get_functiondef(signature);
    if strpos(definition,old_order)=0 or strpos(definition,'  with filtered_notes as (')=0
      or strpos(definition,'p_amount_focus text DEFAULT NULL::text)')=0 then
      raise exception '对账报表定义已变更，排序迁移已停止'; end if;
    definition:=replace(definition,'FUNCTION public.'||source_name||'(',
      'FUNCTION public.'||target_name||'(');
    definition:=replace(definition,'p_amount_focus text DEFAULT NULL::text)',
      'p_amount_focus text DEFAULT NULL::text, p_sort text DEFAULT ''document_date''::text, p_direction text DEFAULT ''desc''::text)');
    definition:=replace(definition,'  with filtered_notes as (',
      E'  if p_sort not in (''document_date'',''supplier_code'',''note_number'',''quantity'',''due'',''paid'',''unpaid'')\n'
      ||E'    or p_direction not in (''asc'',''desc'') then\n'
      ||E'    raise exception ''排序条件无效''; end if;\n  with filtered_notes as (');
    definition:=replace(definition,old_order,new_order);
    execute definition;
  end loop;
end $$;

revoke all on function public.supplier_reconciliation_report_checked_sorted(date,date,uuid,integer,integer,text,text,text,text) from public,anon;
grant execute on function public.supplier_reconciliation_report_checked_sorted(date,date,uuid,integer,integer,text,text,text,text) to authenticated;
revoke all on function public.supplier_reconciliation_report_search_checked_sorted(date,date,uuid,integer,integer,text,text,text,text,text) from public,anon;
grant execute on function public.supplier_reconciliation_report_search_checked_sorted(date,date,uuid,integer,integer,text,text,text,text,text) to authenticated;
commit;
