begin;
set local lock_timeout = '5s';

-- Paper delivery notes may show goods alone or goods plus supplier packaging.
-- Keep payable and monthly totals untouched; only correct detail-status filters.
do $$
declare
  signature regprocedure;
  definition text;
  old_mismatch text := 'abs(n.paper_total_cny - n.goods_allocated_cny) > 0.005';
  old_match text := 'abs(n.paper_total_cny - n.goods_allocated_cny) <= 0.005';
begin
  foreach signature in array array[
    'public.supplier_reconciliation_report_checked(date,date,uuid,integer,integer,text,text)'::regprocedure,
    'public.supplier_reconciliation_report_search_checked(date,date,uuid,integer,integer,text,text,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if (length(definition)-length(replace(definition,old_mismatch,''))) / length(old_mismatch) <> 2
      or (length(definition)-length(replace(definition,old_match,''))) / length(old_match) <> 1 then
      raise exception 'Supplier check-status definition changed; review the comparison before migration';
    end if;
    definition := replace(definition,old_mismatch,
      '(abs(n.paper_total_cny - n.goods_allocated_cny) > 0.005 and abs(n.paper_total_cny - n.allocated_cny) > 0.005)');
    definition := replace(definition,old_match,
      '(abs(n.paper_total_cny - n.goods_allocated_cny) <= 0.005 or abs(n.paper_total_cny - n.allocated_cny) <= 0.005)');
    execute definition;
  end loop;
end $$;

commit;
