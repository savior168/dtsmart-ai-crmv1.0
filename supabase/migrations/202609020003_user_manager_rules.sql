-- Sales users receive the default supervisor when none is selected. Other
-- roles have no manager by default, while administrators may explicitly set
-- or clear an active supervisor for an individual account.
create or replace function public.set_default_sales_manager()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.manager_id = new.id then
    raise exception '用户不能设置自己为上级';
  end if;
  if new.role='SALES' and new.manager_id is null then
    select id into new.manager_id from public.users
    where role='SUPERVISOR' and status='ACTIVE'
      and (lower(trim(coalesce(name,'')))='eva' or lower(email)='3041624715@qq.com')
    order by case when lower(trim(coalesce(name,'')))='eva' then 0 else 1 end,created_at
    limit 1;
  end if;
  return new;
end $$;

-- Supervisors are independent by default. Existing values created by an older
-- rule are cleared once; administrators can assign one later when required.
update public.users set manager_id=null where role='SUPERVISOR';
