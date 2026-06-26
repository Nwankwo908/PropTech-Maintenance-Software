-- PM compliance due dates + inspection vs appliance task kind.

alter table public.unit_assets
  add column if not exists due_at timestamptz,
  add column if not exists task_kind text not null default 'appliance'
    check (task_kind in ('appliance', 'inspection'));

comment on column public.unit_assets.due_at is
  'When replacement or inspection is due; drives overdue / due-in-X-days labels in analytics.';
comment on column public.unit_assets.task_kind is
  'appliance = asset replacement/failure prediction; inspection = scheduled PM inspection.';

create index if not exists unit_assets_landlord_due_at_idx
  on public.unit_assets (landlord_id, due_at);
