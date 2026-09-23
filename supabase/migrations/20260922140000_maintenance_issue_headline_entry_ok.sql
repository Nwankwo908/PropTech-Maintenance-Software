-- Clean vendor-facing issue line (separate from the description that accumulates
-- intake Q&A). Entry permission as its own yes/no, not buried in description.

alter table public.maintenance_requests
  add column if not exists issue_headline text,
  add column if not exists entry_ok_if_absent boolean;

comment on column public.maintenance_requests.issue_headline is
  'Short plain-language issue line for vendor SMS and cards. Not the raw description with intake Q&A appended.';

comment on column public.maintenance_requests.entry_ok_if_absent is
  'True when the resident said staff/vendors may enter if they are not home. Null when unknown.';
