-- 操作日志只保留任务级重要事件；以下索引优化全局倒序查询与按类型筛选。
create index if not exists audit_logs_created_at_desc_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_action_created_at_desc_idx
  on public.audit_logs (action, created_at desc);
