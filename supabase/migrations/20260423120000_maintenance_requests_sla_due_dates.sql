-- SLA: AI-classified category/severity + deterministic due window (see src/lib/slaRules.ts).

alter table public.maintenance_requests
  add column if not exists due_at timestamptz,
  add column if not exists estimated_minutes integer,
  add column if not exists severity text;

alter table public.maintenance_requests
  add column if not exists issue_category text;

comment on column public.maintenance_requests.due_at is
  'Target resolution time computed from SLA_RULES + estimated_minutes from ticket creation.';
comment on column public.maintenance_requests.estimated_minutes is
  'SLA window in minutes from deterministic rules (not from AI).';
comment on column public.maintenance_requests.severity is
  'AI/classifier severity: low | normal | urgent; drives SLA tier with issue_category.';
comment on column public.maintenance_requests.issue_category is
  'AI/classifier bucket (e.g. plumbing, electrical) for SLA and vendor routing.';
