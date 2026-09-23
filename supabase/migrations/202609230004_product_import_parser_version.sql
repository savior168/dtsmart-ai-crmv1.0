-- A corrected parser must never reuse a review batch whose source coordinates
-- were produced by the earlier worksheet-relative implementation.
begin;

alter table public.product_import_batches
  add column if not exists parser_version text not null default 'legacy';

alter table public.product_import_batches
  drop constraint if exists product_import_batches_file_sha256_key;

create unique index if not exists product_import_batches_file_parser_unique
  on public.product_import_batches(file_sha256,parser_version);

create or replace function public.guard_product_import_parser_version()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='PUBLISHING' and old.status is distinct from 'PUBLISHING'
    and (new.parser_version is distinct from 'A1-V12'
      or new.summary->>'parser_version' is distinct from 'A1-V12') then
    raise exception '该导入批次使用旧版解析坐标，禁止发布；请重新导入原文件并核对';
  end if;
  return new;
end $$;

drop trigger if exists product_import_parser_version_guard on public.product_import_batches;
create trigger product_import_parser_version_guard
before update of status on public.product_import_batches
for each row execute function public.guard_product_import_parser_version();

commit;
