begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Existing PI records are preserved; all new and updated direct PI orders
-- require the four customer delivery fields used by preview and stock handoff.
alter table public.sales_orders
  add constraint direct_pi_delivery_contact_required
  check (
    confirmation_method is distinct from 'DIRECT_PI'
    or (
      nullif(btrim(delivery_recipient), '') is not null
      and nullif(btrim(delivery_phone), '') is not null
      and nullif(btrim(delivery_email), '') is not null
      and nullif(btrim(delivery_address), '') is not null
      and delivery_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ) not valid;

alter table public.sales_orders validate constraint direct_pi_delivery_contact_required;

commit;
