-- Evidence detail pages and recovery audits frequently resolve evidence by
-- the durable screening item. Keep this lookup indexed so one customer's
-- evidence never requires scanning the complete evidence history.
create index if not exists ai_screening_evidence_task_item_fetched_idx
  on public.ai_screening_evidence(task_item_id, fetched_at);
