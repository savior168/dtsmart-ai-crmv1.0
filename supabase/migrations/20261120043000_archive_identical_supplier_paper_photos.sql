begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A reused paper may have several uploaded copies of the same bytes. Keep
-- every object and attachment row for audit, but expose only one active copy.
create function public.archive_identical_supplier_paper_photos(p_note_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare archived_count integer;
begin
  with ranked as (
    select a.id,
      first_value(a.id) over duplicate_group as keeper_id,
      row_number() over duplicate_group as copy_number
    from public.attachments a
    join storage.objects o on o.bucket_id = 'crm-attachments' and o.name = a.storage_path
    where a.supplier_delivery_note_id = p_note_id
      and a.kind = 'SUPPLIER_DELIVERY_NOTE'
      and a.supplier_photo_superseded_at is null
      and nullif(o.metadata->>'eTag', '') is not null
    window duplicate_group as (
      partition by a.supplier_delivery_note_id, o.metadata->>'eTag', o.metadata->>'size'
      order by a.created_at, a.id
    )
  )
  update public.attachments a
    set supplier_photo_superseded_at = now(),
        supplier_photo_superseded_by = ranked.keeper_id
    from ranked
    where a.id = ranked.id and ranked.copy_number > 1;
  get diagnostics archived_count = row_count;
  return archived_count;
end;
$$;
revoke all on function public.archive_identical_supplier_paper_photos(uuid) from public, anon, authenticated;

-- The merge function already locks both source and target notes. Archive
-- exact duplicate copies after reparenting, in that same transaction.
do $migration$
declare
  definition text;
  marker text := 'update public.attachments set supplier_delivery_note_id=existing.id' || E'\n'
    || '    where supplier_delivery_note_id=pending.id;';
begin
  definition := pg_get_functiondef(
    'public.complete_or_reuse_supplier_delivery_note_number(uuid,text,timestamptz,boolean)'::regprocedure);
  if strpos(definition, marker) = 0 then
    raise exception '纸单共用函数已变化，请人工核对去重位置';
  end if;
  definition := replace(definition, marker,
    marker || E'\n  perform public.archive_identical_supplier_paper_photos(existing.id);');
  execute definition;
end;
$migration$;

-- Repair only notes with byte-identical active copies. No file or attachment
-- is deleted; the duplicate rows remain available as historical evidence.
do $backfill$
declare paper record;
begin
  for paper in
    select distinct a.supplier_delivery_note_id as id
    from public.attachments a
    join storage.objects o on o.bucket_id = 'crm-attachments' and o.name = a.storage_path
    where a.kind = 'SUPPLIER_DELIVERY_NOTE'
      and a.supplier_delivery_note_id is not null
      and a.supplier_photo_superseded_at is null
      and nullif(o.metadata->>'eTag', '') is not null
    group by a.supplier_delivery_note_id, o.metadata->>'eTag', o.metadata->>'size'
    having count(*) > 1
  loop
    perform public.archive_identical_supplier_paper_photos(paper.id);
  end loop;
end;
$backfill$;
commit;
