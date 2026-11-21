begin;
set local lock_timeout = '5s';

-- Keep the existing financial summaries unchanged. Only the detail rows and
-- their pagination count are narrowed by the two optional detail filters.
do $$
declare
  source_signature text;
  source_name text;
  target_name text;
  definition text;
  original text;
  status_where text := $condition$
      (p_check_status is null
        or (p_check_status = 'NUMBER_PENDING' and n.number_pending)
        or (p_check_status = 'PHOTO_MISSING' and not exists (
          select 1 from public.attachments att
          where att.supplier_delivery_note_id = n.id
            and att.supplier_photo_superseded_at is null))
        or (p_check_status = 'AMOUNT_PENDING' and n.paper_total_cny is null)
        or (p_check_status = 'AMOUNT_MISMATCH' and n.paper_total_cny is not null
          and abs(n.paper_total_cny - n.goods_allocated_cny) > 0.005)
        or (p_check_status = 'MATCHED' and not n.number_pending
          and n.paper_total_cny is not null
          and abs(n.paper_total_cny - n.goods_allocated_cny) <= 0.005
          and exists (select 1 from public.attachments att
            where att.supplier_delivery_note_id = n.id
              and att.supplier_photo_superseded_at is null))
        or (p_check_status = 'NEEDS_ATTENTION' and (
          n.number_pending or n.paper_total_cny is null
          or abs(n.paper_total_cny - n.goods_allocated_cny) > 0.005
          or not exists (select 1 from public.attachments att
            where att.supplier_delivery_note_id = n.id
              and att.supplier_photo_superseded_at is null)))
      )
      and (p_amount_focus is null
        or (p_amount_focus = 'PAID' and n.paid_cny > 0)
        or (p_amount_focus = 'UNPAID' and n.allocated_cny - n.paid_cny > 0))
$condition$;
begin
  foreach source_signature in array array[
    'public.supplier_reconciliation_report(date,date,uuid,integer,integer)',
    'public.supplier_reconciliation_report_search(date,date,uuid,integer,integer,text)'
  ] loop
    source_name := split_part(split_part(source_signature, '(', 1), '.', 2);
    target_name := source_name || '_checked';
    definition := pg_get_functiondef(source_signature::regprocedure);
    original := definition;
    definition := replace(definition, 'FUNCTION public.' || source_name || '(',
      'FUNCTION public.' || target_name || '(');
    if source_name = 'supplier_reconciliation_report_search' then
      definition := replace(definition, 'p_search text DEFAULT NULL::text)',
        'p_search text DEFAULT NULL::text, p_check_status text DEFAULT NULL::text, p_amount_focus text DEFAULT NULL::text)');
    else
      definition := replace(definition, 'p_offset integer DEFAULT 0)',
        'p_offset integer DEFAULT 0, p_check_status text DEFAULT NULL::text, p_amount_focus text DEFAULT NULL::text)');
    end if;
    definition := replace(definition, '  with filtered_notes as (', $validation$
  if p_check_status is not null and p_check_status not in ('NUMBER_PENDING','PHOTO_MISSING','AMOUNT_PENDING','AMOUNT_MISMATCH','MATCHED','NEEDS_ATTENTION')
    or p_amount_focus is not null and p_amount_focus not in ('PAID','UNPAID') then
    raise exception '核对状态或金额筛选无效';
  end if;
  if p_check_status in ('PHOTO_MISSING','MATCHED','NEEDS_ATTENTION')
    and not public.current_user_has_business_permission('supplier.documents.view') then
    raise exception '无纸单查看权限，不能按此核对状态筛选';
  end if;
  with filtered_notes as ($validation$);
    definition := replace(definition, E'  )\n  select jsonb_build_object(',
      E'  ),\n  matching_notes as (\n    select n.* from report_notes n where ' || status_where || E'  )\n  select jsonb_build_object(');
    definition := replace(definition, '    ''legacy_unlinked'',',
      E'    ''detail_count'', (select count(*) from matching_notes),\n    ''legacy_unlinked'',');
    definition := replace(definition,
      'from (select * from report_notes order by document_date desc,id desc',
      'from (select * from matching_notes order by document_date desc,id desc');
    if definition = original or position('matching_notes as (' in definition) = 0
      or position('detail_count' in definition) = 0
      or position('p_amount_focus text DEFAULT NULL::text)' in definition) = 0
      or position('from (select * from matching_notes order by' in definition) = 0
      or position('if p_check_status is not null' in definition) = 0 then
      raise exception 'Supplier reconciliation report definition changed; filter migration stopped';
    end if;
    execute definition;
  end loop;
end $$;

revoke all on function public.supplier_reconciliation_report_checked(date,date,uuid,integer,integer,text,text)
  from public, anon;
grant execute on function public.supplier_reconciliation_report_checked(date,date,uuid,integer,integer,text,text)
  to authenticated;
revoke all on function public.supplier_reconciliation_report_search_checked(date,date,uuid,integer,integer,text,text,text)
  from public, anon;
grant execute on function public.supplier_reconciliation_report_search_checked(date,date,uuid,integer,integer,text,text,text)
  to authenticated;
commit;
