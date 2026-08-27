-- Customer detail editing persists user-entered notes. Keep this idempotent so
-- partially initialized production databases can safely apply it again.
alter table if exists public.customers
  add column if not exists notes text;

notify pgrst, 'reload schema';
