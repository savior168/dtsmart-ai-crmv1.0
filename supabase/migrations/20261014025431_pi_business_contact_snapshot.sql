-- Keep login identity separate from the seller's customer-facing PI contact.
-- Existing PI snapshots and account identifiers are not changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles add column if not exists business_phone text;
alter table public.profiles add column if not exists business_email text;

do $$
declare
  definition text;
  old_snapshot text := '(select p.phone from public.profiles p where p.id=actor.id),actor.email,';
  new_snapshot text := '(select coalesce(nullif(trim(p.business_phone),''''),p.phone) from public.profiles p where p.id=actor.id),' || chr(10) ||
    '    coalesce((select nullif(trim(p.business_email),'''') from public.profiles p where p.id=actor.id),actor.email),';
begin
  definition := pg_get_functiondef('public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  if position(old_snapshot in definition) = 0 then
    raise exception 'PI seller contact snapshot changed; review before applying';
  end if;
  execute replace(definition, old_snapshot, new_snapshot);
end $$;

commit;
