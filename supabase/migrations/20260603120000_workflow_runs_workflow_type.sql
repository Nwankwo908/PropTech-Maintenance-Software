-- Ensure workflow_runs.workflow_type exists and mirrors template_id.
-- Safe for existing rent_collection runs: backfill uses template_id (e.g. rent_collection).

alter table public.workflow_runs
  add column if not exists workflow_type text;

update public.workflow_runs
set workflow_type = nullif(trim(template_id), '')
where workflow_type is null
   or trim(workflow_type) = '';

comment on column public.workflow_runs.workflow_type is
  'Workflow template key (mirrors template_id), e.g. rent_collection, lease_renewal.';

create index if not exists workflow_runs_workflow_type_idx
  on public.workflow_runs (workflow_type);

create or replace function public.sync_workflow_run_workflow_type()
returns trigger
language plpgsql
as $$
begin
  if new.workflow_type is null or trim(new.workflow_type) = '' then
    new.workflow_type := new.template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_runs_sync_workflow_type on public.workflow_runs;

create trigger workflow_runs_sync_workflow_type
  before insert or update of template_id, workflow_type
  on public.workflow_runs
  for each row
  execute function public.sync_workflow_run_workflow_type();

-- Backfill any rows inserted while workflow_type was null.
update public.workflow_runs
set workflow_type = nullif(trim(template_id), '')
where workflow_type is null
   or trim(workflow_type) = '';
