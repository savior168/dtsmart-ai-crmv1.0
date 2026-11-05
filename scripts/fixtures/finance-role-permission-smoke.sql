select set_config('test.actor_id','00000000-0000-0000-0000-000000000001',false);

do $$
begin
  if (select enabled from public.role_permission_settings
      where role_code='ORDER_CLERK' and permission_code='orders.cancel') then
    raise exception 'historically blocked clerk cancellation was not kept off';
  end if;
  if not (select enabled from public.role_permission_settings
      where role_code='ORDER_CLERK' and permission_code='stock.preview') then
    raise exception 'existing clerk stock preview permission was changed';
  end if;
  if not (select enabled from public.role_permission_settings
      where role_code='ORDER_CLERK' and permission_code='orders.view') then
    raise exception 'existing clerk page permission was changed';
  end if;
  if exists (select 1 from public.role_permission_settings
      where role_code in ('SALES','SUPERVISOR')
        and permission_code in ('ai.tasks.view','customers.ai_evidence_view')
        and enabled) then
    raise exception 'historically masked sales permissions were exposed';
  end if;
  if (select count(*) from public.role_permission_settings
      where role_code in ('SALES','SUPERVISOR')
        and permission_code in ('ai.tasks.view','customers.ai_evidence_view')) <> 4 then
    raise exception 'masked sales permission defaults were not persisted';
  end if;
  if public.current_user_has_business_permission('orders.cancel') then
    raise exception 'clerk cancel default unexpectedly enabled';
  end if;
end;
$$;

update public.role_permission_settings set enabled=true
where role_code='ORDER_CLERK' and permission_code='orders.cancel';
do $$ begin
  if not public.current_user_has_business_permission('orders.cancel') then
    raise exception 'explicit administrator role grant was ignored';
  end if;
end $$;

update public.role_permission_settings set enabled=false
where role_code='ORDER_CLERK' and permission_code='orders.view';
do $$ begin
  if public.current_user_has_business_permission('orders.cancel') then
    raise exception 'closed page did not block direct RPC permission';
  end if;
end $$;

insert into public.user_permission_overrides(user_id,permission_code,effect)
values ('00000000-0000-0000-0000-000000000001','orders.view','ALLOW');
do $$ begin
  if not public.current_user_has_business_permission('orders.cancel') then
    raise exception 'explicit page override did not restore access';
  end if;
end $$;

insert into public.user_permission_overrides(user_id,permission_code,effect)
values ('00000000-0000-0000-0000-000000000001','orders.cancel','DENY');
do $$ begin
  if public.current_user_has_business_permission('orders.cancel') then
    raise exception 'user DENY did not override role grant';
  end if;
end $$;

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('ORDER_CLERK','pricebooks.manage',true),('ORDER_CLERK','pricebooks.view',true);
do $$ begin
  if public.current_user_has_business_permission('pricebooks.manage') then
    raise exception 'admin-only permission leaked through direct RPC';
  end if;
end $$;

insert into public.users(id,role) values
  ('00000000-0000-0000-0000-000000000003','FINANCE');
select set_config('test.actor_id','00000000-0000-0000-0000-000000000003',false);
do $$ begin
  if not public.current_user_has_business_permission('suppliers.view')
    or public.current_user_has_business_permission('suppliers.manage') then
    raise exception 'finance supplier defaults were changed';
  end if;
end $$;
insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('FINANCE','suppliers.manage',true);
do $$ begin
  if not public.current_user_has_business_permission('suppliers.manage') then
    raise exception 'explicit finance supplier maintenance grant did not take effect';
  end if;
end $$;
update public.role_permission_settings set enabled=false
where role_code='FINANCE' and permission_code='suppliers.view';
do $$ begin
  if public.current_user_has_business_permission('suppliers.manage') then
    raise exception 'closed supplier page did not block finance maintenance';
  end if;
end $$;

select set_config('test.actor_id','00000000-0000-0000-0000-000000000002',false);
do $$ begin
  if public.current_user_has_business_permission('products.manage')
    or public.current_user_has_business_permission('products.categories.manage') then
    raise exception 'product maintenance default changed';
  end if;
end $$;
insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('SALES','products.view',true),('SALES','products.manage',true),
  ('SALES','products.categories.view',true),('SALES','products.categories.manage',true)
on conflict (role_code,permission_code) do update set enabled=true;
do $$ begin
  if not public.current_user_has_business_permission('products.manage')
    or not public.current_user_has_business_permission('products.categories.manage') then
    raise exception 'explicit product maintenance grant did not take effect';
  end if;
end $$;

set role authenticated;
do $$ begin
  if (select count(*) from public.pi_exchange_rate_rules) <> 0
    or (select count(*) from public.pi_payment_accounts) <> 0 then
    raise exception 'financial settings visible without page grants';
  end if;
  begin
    insert into public.pi_exchange_rate_rules(currency) values ('EUR');
    raise exception 'financial settings write succeeded without manage grant';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('SALES','pi.rates.view',true),('SALES','pi.accounts.view',true)
on conflict (role_code,permission_code) do update set enabled=true;
set role authenticated;
do $$ begin
  if (select count(*) from public.pi_exchange_rate_rules) <> 1
    or (select count(*) from public.pi_payment_accounts) <> 1 then
    raise exception 'granted financial settings page did not make records readable';
  end if;
  begin
    insert into public.pi_exchange_rate_rules(currency) values ('EUR');
    raise exception 'financial settings page grant also allowed write';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('SALES','pi.rates.manage',true),('SALES','pi.accounts.manage',true)
on conflict (role_code,permission_code) do update set enabled=true;
set role authenticated;
insert into public.pi_exchange_rate_rules(currency) values ('EUR');
update public.pi_exchange_rate_rules set adjustment_value=-0.1 where currency='USD';
insert into public.pi_payment_accounts(id,label) values
  ('00000000-0000-0000-0000-000000000052','Granted account');
update public.pi_payment_accounts set label='Updated account'
where id='00000000-0000-0000-0000-000000000051';
do $$ begin
  if (select count(*) from public.pi_exchange_rate_rules) <> 2
    or (select count(*) from public.pi_payment_accounts) <> 2
    or (select adjustment_value from public.pi_exchange_rate_rules where currency='USD') <> -0.1
    or (select label from public.pi_payment_accounts where id='00000000-0000-0000-0000-000000000051') <> 'Updated account' then
    raise exception 'financial settings grant did not allow expected read/write';
  end if;
end $$;
reset role;
select set_config('test.actor_id','00000000-0000-0000-0000-000000000003',false);
set role authenticated;
do $$ begin
  if (select count(*) from public.pi_exchange_rate_rules) <> 0
    or (select count(*) from public.pi_payment_accounts) <> 0 then
    raise exception 'finance can read financial settings without explicit grants';
  end if;
end $$;
reset role;
insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('FINANCE','pi.rates.view',true),('FINANCE','pi.rates.manage',true),
  ('FINANCE','pi.accounts.view',true),('FINANCE','pi.accounts.manage',true)
on conflict (role_code,permission_code) do update set enabled=true;
set role authenticated;
insert into public.pi_exchange_rate_rules(currency) values ('GBP');
insert into public.pi_payment_accounts(id,label) values
  ('00000000-0000-0000-0000-000000000053','Finance account');
do $$ begin
  if (select count(*) from public.pi_exchange_rate_rules) <> 3
    or (select count(*) from public.pi_payment_accounts) <> 3 then
    raise exception 'explicit finance grants did not enable financial settings';
  end if;
end $$;
reset role;
