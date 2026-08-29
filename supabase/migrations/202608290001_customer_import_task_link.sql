-- Use the immutable import task id as the batch identity. Filenames remain labels only.
alter table if exists public.customers
  add column if not exists source_batch_id uuid references public.import_tasks(id) on delete set null;

-- Backfill only when the same user's matching task is close enough to the
-- customer creation time. This avoids binding repeated filenames arbitrarily.
update public.customers as customer
set source_batch_id = (
  select task.id
  from public.import_tasks as task
  where task.created_by = customer.created_by
    and task.filename = customer.source_batch
    and coalesce(task.success_count, 0) > 0
    and abs(extract(epoch from (customer.created_at - task.created_at))) <= 21600
  order by abs(extract(epoch from (customer.created_at - task.created_at))), task.created_at desc
  limit 1
)
where customer.source_batch_id is null
  and nullif(btrim(customer.source_batch), '') is not null
  and exists (
    select 1
    from public.import_tasks as task
    where task.created_by = customer.created_by
      and task.filename = customer.source_batch
      and coalesce(task.success_count, 0) > 0
      and abs(extract(epoch from (customer.created_at - task.created_at))) <= 21600
  );

create index if not exists customers_source_batch_id_idx
  on public.customers(source_batch_id)
  where source_batch_id is not null;

create index if not exists customers_ai_batch_pending_idx
  on public.customers(created_by, source_batch_id, created_at desc)
  where deleted_at is null and ai_score is null;
