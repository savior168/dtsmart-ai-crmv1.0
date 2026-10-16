begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Supabase may grant table/function privileges to API roles by default.
-- RLS is defense in depth, not a substitute for least-privilege grants.
revoke all on table public.notification_delivery_policies from public, anon, authenticated;
grant select on table public.notification_delivery_policies to authenticated;

revoke all on table public.user_notification_preferences from public, anon, authenticated;
grant select, insert, update on table public.user_notification_preferences to authenticated;

revoke all on table public.system_announcements from public, anon, authenticated;

revoke all on function public.set_notification_delivery_policy(text,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.set_notification_delivery_policy(text,boolean,boolean)
  to authenticated;

revoke all on function public.publish_system_announcement(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.publish_system_announcement(uuid,text,text)
  to authenticated;

commit;
