-- Preserve historical reviews and notifications, but stop new purchase-price
-- based reminders and calls to the obsolete review RPC.
drop trigger if exists pi_seller_cost_review_after_handoff on public.stock_orders;
revoke execute on function public.review_shipped_pi_seller_cost(uuid,uuid,numeric,numeric,text)
  from public, anon, authenticated;
