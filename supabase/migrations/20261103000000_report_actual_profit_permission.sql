-- Preserve existing supervisor access while making actual profit revocable and
-- independently grantable through the role/user permission settings.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('SUPERVISOR', 'reports.actual_profit.view', true),
       ('ADMIN', 'reports.actual_profit.view', true)
on conflict (role_code, permission_code) do nothing;

commit;
