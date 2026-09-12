begin;

-- Keep the customer-list filter truthful for existing records created before
-- the explicit AI analysis state was introduced. A durable scored result is
-- "已分析"; a terminal task failure with no score is "分析失败". Everything
-- else remains "未分析" and is never silently presented as completed.
update public.customers
set ai_status = 'COMPLETED',
    ai_screening_done = true,
    updated_at = now()
where ai_score is not null
  and coalesce(ai_status, 'PENDING') <> 'COMPLETED';

with latest_terminal_item as (
  select distinct on (customer_id)
    customer_id,
    status,
    analysis_status,
    writeback_status
  from public.ai_screening_task_items
  order by customer_id, updated_at desc nulls last, completed_at desc nulls last, id desc
)
update public.customers customer
set ai_status = 'FAILED',
    ai_screening_done = false,
    updated_at = now()
from latest_terminal_item item
where customer.id = item.customer_id
  and customer.ai_score is null
  and (item.status = 'FAILED' or item.analysis_status = 'FAILED' or item.writeback_status = 'FAILED')
  and coalesce(customer.ai_status, 'PENDING') <> 'FAILED';

commit;
