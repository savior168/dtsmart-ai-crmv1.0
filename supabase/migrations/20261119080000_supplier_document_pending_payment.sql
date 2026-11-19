begin;

-- Historical rows predate this distinction; NULL means unknown, not complete.
alter table public.supplier_payments
  add column documents_pending_at_payment boolean;
comment on column public.supplier_payments.documents_pending_at_payment is
  'Whether the real delivery-note number or its paper attachment was missing when payment was recorded; NULL for historical rows.';

-- Actual disbursements must be recorded even when the warehouse has not yet
-- supplied the paper document. Require a traceable payment basis in that case,
-- retain the outstanding document state, and never fabricate a note number.
create or replace function public.reject_pending_supplier_note_payment()
returns trigger language plpgsql set search_path = '' as $$
declare
  pending_number boolean;
  pending_photo boolean;
begin
  select n.number_pending into pending_number
  from public.supplier_delivery_notes n where n.id = new.delivery_note_id;
  if pending_number is null then
    raise exception '送货单不存在';
  end if;
  pending_photo := not exists (
    select 1 from public.attachments a
    where a.supplier_delivery_note_id = new.delivery_note_id
  );
  if (pending_number or pending_photo)
    and nullif(btrim(coalesce(new.payment_reference, '')), '') is null then
    raise exception '送货单资料待补，请填写真实付款依据或流水号';
  end if;
  if tg_op = 'INSERT' then
    new.documents_pending_at_payment := pending_number or pending_photo;
  end if;
  return new;
end;
$$;

commit;
