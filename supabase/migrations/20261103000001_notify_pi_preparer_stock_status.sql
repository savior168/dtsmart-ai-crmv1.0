-- Mirror warehouse stock updates to the PI preparer when they differ from the salesperson.
-- Existing stock workflows already notify the salesperson. Mirroring the committed
-- notification keeps both recipients in the same transaction without changing RPCs.
create or replace function public.notify_pi_preparer_of_stock_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  preparer_id uuid;
begin
  if new.type <> 'STOCK_STATUS_CHANGED'
    or new.entity_type <> 'stock_order'
    or new.entity_id is null then
    return new;
  end if;

  select so.prepared_by into preparer_id
  from public.stock_orders st
  join public.sales_orders so on so.id = st.sales_order_id
  join public.users preparer on preparer.id = so.prepared_by
  where st.id = new.entity_id
    and st.sales_user_id = new.recipient_id
    and so.prepared_by is distinct from st.sales_user_id
    and preparer.status = 'ACTIVE';

  if preparer_id is null then
    return new;
  end if;

  insert into public.system_notifications
    (recipient_id, type, category, title, content, href, metadata,
     entity_type, entity_id, dedupe_key, deliver_at, action_status)
  values
    (preparer_id, new.type, new.category, new.title, new.content, new.href,
     new.metadata, new.entity_type, new.entity_id, new.dedupe_key,
     new.deliver_at, new.action_status)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

revoke all on function public.notify_pi_preparer_of_stock_update() from public, anon, authenticated;

drop trigger if exists notify_pi_preparer_of_stock_update on public.system_notifications;
create trigger notify_pi_preparer_of_stock_update
after insert on public.system_notifications
for each row execute function public.notify_pi_preparer_of_stock_update();
