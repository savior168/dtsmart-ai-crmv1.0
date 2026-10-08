-- Run with the migration installed using a database administration connection.
-- All fixtures, customer changes, reminders and audit records are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  admin_id uuid;
  sales_id uuid;
  test_customer_id uuid := gen_random_uuid();
  old_followup_id uuid;
  current_followup_id uuid;
  request_id uuid := gen_random_uuid();
  saved jsonb;
  replay jsonb;
  queue_id uuid;
  original_due timestamptz := now() + interval '2 days';
  audit_row jsonb;
  rejected boolean;
begin
  select id into admin_id from public.users where role='ADMIN' and status='ACTIVE' order by created_at limit 1;
  select id into sales_id from public.users where role='SALES' and status='ACTIVE' order by created_at limit 1;
  if admin_id is null or sales_id is null then raise exception 'Two-account verification requires active ADMIN and SALES accounts'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);

  insert into public.customers(id,company_name,country,owner_id,owner_user_id,created_by,status,acquisition_scope,claimed_at)
  values(test_customer_id,'__ROLLBACK_FOLLOWUP_TEST__','英国',admin_id,admin_id,admin_id,'CLAIMED','PRIVATE',now()-interval '1 day');
  saved := public.create_customer_followup(test_customer_id,'EMAIL','First interaction',now()+interval '1 day','CONTACT_ONLY',null,gen_random_uuid());
  old_followup_id := (saved->>'id')::uuid;
  update public.followups set created_at=now()-interval '1 hour' where id=old_followup_id;

  saved := public.create_customer_followup(test_customer_id,'PHONE','Current interaction',original_due,'CONTACT_ONLY','WAITING_REPLY',request_id);
  current_followup_id := (saved->>'id')::uuid;
  replay := public.create_customer_followup(test_customer_id,'PHONE','Current interaction',original_due,'CONTACT_ONLY','WAITING_REPLY',request_id);
  if replay->>'id' is distinct from saved->>'id'
    or (select count(*) from public.followups where customer_id=test_customer_id) <> 2 then
    raise exception 'Idempotent replay created a duplicate';
  end if;
  if (select followup_status from public.customers where id=test_customer_id) <> 'WAITING_REPLY' then
    raise exception 'Follow-up status did not save with interaction';
  end if;
  if (select count(*) from public.audit_logs where target_id=test_customer_id and action='FOLLOWUP_CREATE') <> 2 then
    raise exception 'Create audit was missing or duplicated';
  end if;

  perform public.correct_customer_followup(old_followup_id,'EMAIL','Corrected historical interaction',now()+interval '3 days','Historical record correction');
  select id into queue_id from public.customer_followup_queue where customer_id=test_customer_id;
  if queue_id is distinct from current_followup_id then raise exception 'Historical correction replaced current queue'; end if;
  if (select count(*) from public.system_notifications where entity_type='followup'
    and entity_id in(old_followup_id,current_followup_id) and action_status='PENDING') <> 1
    or not exists(select 1 from public.system_notifications where entity_id=current_followup_id
      and action_status='PENDING' and deliver_at=original_due) then
    raise exception 'Historical correction changed current notification';
  end if;
  select content into audit_row from public.audit_logs where target_id=test_customer_id and action='FOLLOWUP_UPDATE' limit 1;
  if audit_row#>>'{before,content}' <> 'First interaction'
    or audit_row#>>'{after,content}' <> 'Corrected historical interaction' then
    raise exception 'Correction audit did not preserve before/after';
  end if;

  rejected := false;
  begin
    perform public.create_customer_followup(test_customer_id,'PHONE','Changed replay',original_due,'CONTACT_ONLY',null,request_id);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Changed idempotent payload was accepted'; end if;

  -- No new follow-up is created by administrator reassignment. Prior plans
  -- must not be inherited, including when the previous owner claims again.
  update public.followups set created_at=now()-interval '1 minute' where id=current_followup_id;
  update public.customers set owner_id=sales_id,owner_user_id=sales_id,claimed_at=now() where id=test_customer_id;
  if not exists(select 1 from public.customer_followup_queue where customer_id=test_customer_id and next_follow_date is null) then
    raise exception 'Reassignment inherited previous ownership plan';
  end if;
  if exists(select 1 from public.system_notifications where entity_id in(old_followup_id,current_followup_id) and action_status='PENDING') then
    raise exception 'Reassignment left old owner reminder pending';
  end if;

  -- Claim creates its interaction before ownership update in the same
  -- transaction: both use now(), so equality at the cutoff is required.
  saved := public.create_customer_followup(test_customer_id,'EMAIL','Admin on behalf of owner',original_due,'CONTACT_ONLY',null,gen_random_uuid());
  current_followup_id := (saved->>'id')::uuid;
  if not exists(select 1 from public.customer_followup_queue where customer_id=test_customer_id and id=current_followup_id) then
    raise exception 'Ownership boundary excluded same-transaction interaction';
  end if;
  if not exists(select 1 from public.system_notifications where entity_id=current_followup_id
    and recipient_id=sales_id and action_status='PENDING') then
    raise exception 'Administrator-created plan was not assigned to customer owner';
  end if;

  perform set_config('request.jwt.claim.sub',sales_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',sales_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select id into queue_id from public.customer_followup_queue where customer_id=test_customer_id;
  execute 'reset role';
  if queue_id is distinct from current_followup_id then raise exception 'Owner cannot see administrator-created current plan under RLS'; end if;

  rejected := false;
  begin
    perform public.correct_customer_followup(current_followup_id,'EMAIL','Unauthorized overwrite',null,'Should not overwrite another author');
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Salesperson corrected another author record'; end if;
  update public.customers set owner_id=admin_id,owner_user_id=admin_id,claimed_at=now() where id=test_customer_id;
  rejected := false;
  begin
    perform public.create_customer_followup(test_customer_id,'EMAIL','Former owner write',null,'CONTACT_ONLY',null,gen_random_uuid());
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Former owner created a follow-up'; end if;

  execute 'set local role authenticated';
  if exists(select 1 from public.followups where customer_id=test_customer_id) then
    raise exception 'Former owner can still read customer follow-ups directly';
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  update public.customers set followup_status='NO_FOLLOWUP' where id=test_customer_id;
  if exists(select 1 from public.customer_followup_queue where customer_id=test_customer_id) then
    raise exception 'Explicit no-followup customer remained in queue';
  end if;
  update public.customers set owner_id=null,owner_user_id=null,claimed_at=null,status='UNCLAIMED' where id=test_customer_id;
  if exists(select 1 from public.customer_followup_queue where customer_id=test_customer_id) then raise exception 'Released customer remained in queue'; end if;
  if has_function_privilege('anon','public.create_customer_followup(uuid,text,text,timestamptz,text,text,uuid)','EXECUTE')
    or has_function_privilege('anon','public.correct_customer_followup(uuid,text,text,timestamptz,text)','EXECUTE') then
    raise exception 'Anonymous users can write follow-ups';
  end if;
  raise notice 'PASS: follow-up idempotency, cycle, historical correction, reminders, audit and two-account ownership tests';
end $$;

rollback;
