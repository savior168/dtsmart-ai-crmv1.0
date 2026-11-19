begin;

create function public.require_supplier_paper_attachment_for_confirmation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.attachments a
    where a.supplier_delivery_note_id = new.id
  ) then
    raise exception '请先上传此送货单对应的纸单影像，再核对纸单金额';
  end if;
  return new;
end;
$$;

create trigger supplier_paper_confirmation_requires_photo
  before update of paper_total_cny on public.supplier_delivery_notes
  for each row when (new.paper_total_cny is distinct from old.paper_total_cny and new.paper_total_cny is not null)
  execute function public.require_supplier_paper_attachment_for_confirmation();

revoke all on function public.require_supplier_paper_attachment_for_confirmation() from public, anon, authenticated;

commit;
