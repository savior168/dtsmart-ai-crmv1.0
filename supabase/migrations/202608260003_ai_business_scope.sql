-- AI business scope and strictly verified scale evidence.
-- Additive and idempotent. Scale fields must remain NULL unless a traceable
-- customs/trade source contains concrete purchase facts.
alter table if exists public.customers
  add column if not exists business_scope text,
  add column if not exists company_scale text,
  add column if not exists company_scale_evidence text;

alter table if exists public.ai_screening_results
  add column if not exists business_scope text,
  add column if not exists company_scale text,
  add column if not exists company_scale_evidence text;

comment on column public.customers.business_scope is 'AI提炼的可核验主营及附带业务';
comment on column public.customers.company_scale is '仅由可追溯海关或交易事实支持的企业规模';
comment on column public.customers.company_scale_evidence is '企业规模判断的真实来源事实与核验入口';
