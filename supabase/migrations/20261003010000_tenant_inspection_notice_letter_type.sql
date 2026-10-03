-- Tenant-forwarded inspection notices (HABC schedule SMS, etc.) reuse
-- inspection_reports / inspection_source_documents but are not fail letters.
-- letter_type = tenant_notice: date + unit + optional source screenshot;
-- checklist items are maintenance_requests.inspection_report_id (same N-of-M UI).

alter table public.inspection_reports
  drop constraint if exists inspection_reports_letter_type_check;

alter table public.inspection_reports
  add constraint inspection_reports_letter_type_check
  check (letter_type in ('standard_fail', 'hap_abatement', 'tenant_notice'));

comment on column public.inspection_reports.letter_type is
  'standard_fail / hap_abatement = landlord HQS fail letter; tenant_notice = resident-forwarded schedule notice (no pre-itemized deficiencies).';
