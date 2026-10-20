-- Forward-only format: existing document numbers and their audit links stay unchanged.
-- One atomic counter per Asia/Shanghai business day prevents concurrent duplicates.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.stock_order_daily_counters (
  business_date date primary key,
  last_value integer not null check (last_value > 0)
);
revoke all on table public.stock_order_daily_counters from public, anon, authenticated;

create function public.next_stock_order_number()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_day date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
  v_serial integer;
begin
  insert into public.stock_order_daily_counters (business_date, last_value)
  values (v_day, 1)
  on conflict (business_date) do update
    set last_value = public.stock_order_daily_counters.last_value + 1
  returning last_value into v_serial;

  return 'BH' || to_char(v_day, 'YYMMDD') ||
    case when v_serial < 1000 then lpad(v_serial::text, 3, '0') else v_serial::text end;
end;
$$;
revoke all on function public.next_stock_order_number() from public, anon, authenticated;

do $$
declare
  signature text;
  definition text;
  old_format text := '''BH-''||to_char(clock_timestamp(),''YYYYMMDD-HH24MISS'')||''-''||upper(substr(replace(gen_random_uuid()::text,''-'',''''),1,4))';
begin
  foreach signature in array array[
    'public.confirm_quote_create_sales_order(uuid,text,text,text)',
    'public.submit_direct_pi_order(uuid,integer)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position(old_format in definition) = 0 then
      raise exception 'Stock number generator changed; review % before applying', signature;
    end if;
    execute replace(definition, old_format, 'public.next_stock_order_number()');
  end loop;
end $$;

commit;
