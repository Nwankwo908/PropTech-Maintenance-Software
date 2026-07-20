-- Phase 4 / 4.4: vendor completion photos + landlord star rating support.

alter table public.maintenance_requests
  add column if not exists completion_photo_paths text[] not null default '{}';

comment on column public.maintenance_requests.completion_photo_paths is
  'Vendor before/after photos uploaded at job close (private maintenance-uploads paths).';

-- Allow resident + landlord ratings per ticket.
alter table public.vendor_feedback
  add column if not exists rater_type text not null default 'resident';

alter table public.vendor_feedback
  drop constraint if exists vendor_feedback_rater_type_check;

alter table public.vendor_feedback
  add constraint vendor_feedback_rater_type_check
    check (rater_type in ('resident', 'landlord'));

alter table public.vendor_feedback
  drop constraint if exists vendor_feedback_maintenance_request_id_key;

create unique index if not exists vendor_feedback_ticket_rater_uidx
  on public.vendor_feedback (maintenance_request_id, rater_type);

comment on column public.vendor_feedback.rater_type is
  'Who submitted the rating: resident (tenant SMS) or landlord (ops 1-tap).';

alter table public.vendor_feedback_requests
  add column if not exists rater_type text not null default 'resident';

alter table public.vendor_feedback_requests
  drop constraint if exists vendor_feedback_requests_rater_type_check;

alter table public.vendor_feedback_requests
  add constraint vendor_feedback_requests_rater_type_check
    check (rater_type in ('resident', 'landlord'));

alter table public.vendor_feedback_requests
  drop constraint if exists vendor_feedback_requests_maintenance_request_id_key;

create unique index if not exists vendor_feedback_requests_ticket_rater_uidx
  on public.vendor_feedback_requests (maintenance_request_id, rater_type);
