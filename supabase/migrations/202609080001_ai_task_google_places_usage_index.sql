-- Keep task-level and customer-level Google Places usage rollups fast as the
-- immutable API billing ledger grows.
create index if not exists api_cost_task_provider_customer_idx
  on public.api_cost_ledger(task_id, provider, customer_id)
  where task_id is not null;
