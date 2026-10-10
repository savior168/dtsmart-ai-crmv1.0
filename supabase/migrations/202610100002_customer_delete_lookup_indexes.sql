-- Permanent deletion checks/cascades every child table referencing a customer.
-- These lookup indexes avoid repeated full-table scans for each selected row.
-- Apply during a reviewed maintenance window; index creation can briefly lock writes.
create index if not exists ai_acquisition_candidates_staging_customer_idx
  on public.ai_acquisition_candidates(staging_customer_id)
  where staging_customer_id is not null;
create index if not exists ai_acquisition_candidates_imported_customer_idx
  on public.ai_acquisition_candidates(imported_customer_id)
  where imported_customer_id is not null;
create index if not exists ai_acquisition_candidates_screening_item_idx
  on public.ai_acquisition_candidates(screening_task_item_id)
  where screening_task_item_id is not null;
create index if not exists ai_screening_evidence_customer_idx
  on public.ai_screening_evidence(customer_id);
create index if not exists ai_screening_results_task_item_idx
  on public.ai_screening_results(task_item_id)
  where task_item_id is not null;
create index if not exists ai_screening_stage_events_customer_idx
  on public.ai_screening_stage_events(customer_id);
create index if not exists import_rows_customer_idx
  on public.import_rows(customer_id)
  where customer_id is not null;
create index if not exists customer_status_history_customer_idx
  on public.customer_status_history(customer_id);
create index if not exists customer_identity_keys_customer_idx
  on public.customer_identity_keys(customer_id);
create index if not exists customer_sources_customer_idx
  on public.customer_sources(customer_id);
create index if not exists attachments_customer_idx
  on public.attachments(customer_id)
  where customer_id is not null;
create index if not exists attachments_followup_idx
  on public.attachments(followup_id)
  where followup_id is not null;
create index if not exists followup_reminders_customer_idx
  on public.followup_reminders(customer_id);
create index if not exists followup_reminders_followup_idx
  on public.followup_reminders(followup_id)
  where followup_id is not null;
create index if not exists customer_private_supplements_customer_idx
  on public.customer_private_supplements(customer_id);
create index if not exists customer_protection_renewal_requests_customer_idx
  on public.customer_protection_renewal_requests(customer_id);
create index if not exists sales_orders_customer_idx
  on public.sales_orders(customer_id);
