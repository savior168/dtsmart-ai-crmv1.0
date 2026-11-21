begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Historical manual-review rows may have been introduced after a task became
-- terminal. Repair the cached count from the immutable candidate decisions;
-- leave active tasks and their concurrent workflow updates untouched.
with actual as (
  select t.id, count(c.id)::integer as review_count
  from public.ai_acquisition_tasks t
  left join public.ai_acquisition_candidates c
    on c.task_id = t.id and c.decision = 'REVIEW'
  where t.status in ('COMPLETED', 'FAILED', 'CANCELLED')
  group by t.id
)
update public.ai_acquisition_tasks t
set review_count = actual.review_count
from actual
where t.id = actual.id and t.review_count is distinct from actual.review_count;

commit;
