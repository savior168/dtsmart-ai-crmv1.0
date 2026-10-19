-- Prevent concurrent account operations from removing every usable system
-- administrator. The deferred check sees the final state of multi-row updates.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.ensure_available_admin_after_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  was_available boolean;
  is_available boolean := false;
begin
  was_available := old.role = 'ADMIN' and old.status = 'ACTIVE'
    and (old.locked_until is null or old.locked_until <= pg_catalog.now());
  if tg_op = 'UPDATE' then
    is_available := new.role = 'ADMIN' and new.status = 'ACTIVE'
      and (new.locked_until is null or new.locked_until <= pg_catalog.now());
  end if;
  if was_available and not is_available then
    -- Serializes checks across transactions that disable different admins.
    perform pg_catalog.pg_advisory_xact_lock(17001, 1);
    if not exists (
      select 1 from public.users u where u.role = 'ADMIN' and u.status = 'ACTIVE'
        and (u.locked_until is null or u.locked_until <= pg_catalog.now())
    ) then
      raise exception '必须保留至少一名未锁定且已启用的系统管理员'
        using errcode = '23514';
    end if;
  end if;
  return null;
end
$$;

revoke all on function public.ensure_available_admin_after_change() from public, anon, authenticated;
drop trigger if exists ensure_available_admin_after_change on public.users;
create constraint trigger ensure_available_admin_after_change
after update or delete on public.users
deferrable initially deferred
for each row execute function public.ensure_available_admin_after_change();

do $$
begin
  if not exists (
    select 1 from public.users u where u.role = 'ADMIN' and u.status = 'ACTIVE'
      and (u.locked_until is null or u.locked_until <= pg_catalog.now())
  ) then
    raise exception '当前没有未锁定且已启用的系统管理员，取消迁移';
  end if;
end
$$;
commit;
