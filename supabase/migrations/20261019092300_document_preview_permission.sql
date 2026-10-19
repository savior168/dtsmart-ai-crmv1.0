-- Preserve existing preview access while making it independently configurable.
insert into public.role_permission_settings (role_code, permission_code, enabled)
select role_code, replace(permission_code, '.view', '.preview'), enabled
from public.role_permission_settings
where permission_code in ('orders.view', 'stock.view')
on conflict (role_code, permission_code) do nothing;

-- Preserve individual view overrides too. Without this, a user who can see
-- PI/stock only through an explicit ALLOW would lose previews on rollout.
insert into public.user_permission_overrides (user_id, permission_code, effect, updated_by, updated_at)
select user_id, replace(permission_code, '.view', '.preview'), effect, updated_by, updated_at
from public.user_permission_overrides
where permission_code in ('orders.view', 'stock.view')
on conflict (user_id, permission_code) do nothing;

-- The product catalog and category management are separate menu pages. Keep
-- existing visibility and existing administrator-only write authority.
insert into public.role_permission_settings (role_code, permission_code, enabled)
select role_code, 'products.categories.view', enabled
from public.role_permission_settings
where permission_code = 'products.view'
on conflict (role_code, permission_code) do nothing;

insert into public.role_permission_settings (role_code, permission_code, enabled)
values ('ADMIN', 'products.categories.manage', true)
on conflict (role_code, permission_code) do nothing;

-- Internal margin and markup rules must not be exposed by the ordinary sales
-- pricebook permission. Keep this page administrator-only.
insert into public.role_permission_settings (role_code, permission_code, enabled)
values ('ADMIN', 'pricebooks.rules.view', true)
on conflict (role_code, permission_code) do nothing;
