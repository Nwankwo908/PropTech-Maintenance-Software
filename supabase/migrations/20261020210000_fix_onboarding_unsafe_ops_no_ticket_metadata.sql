-- Get started calls start_fresh_onboarding_run → onboarding_inventory_has_unsafe_ops.
-- That helper referenced maintenance_requests.metadata, which does not exist on
-- production (import lineage lives on workflow_runs.metadata.source).

create or replace function public.onboarding_inventory_has_unsafe_ops(p_landlord_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Live maintenance not from Fast Track import lineage (workflow_runs.metadata).
  if exists (
    select 1
    from public.maintenance_requests mr
    where mr.landlord_id = p_landlord_id
      and not exists (
        select 1
        from public.workflow_runs wr
        where wr.landlord_id = p_landlord_id
          and wr.entity_id = mr.id
          and coalesce(wr.metadata ->> 'source', '') = 'onboarding_import'
      )
  ) then
    return true;
  end if;

  if to_regclass('public.unit_assets') is not null then
    if exists (
      select 1 from public.unit_assets ua where ua.landlord_id = p_landlord_id
    ) then
      return true;
    end if;
  end if;

  if to_regclass('public.home_checks') is not null then
    if exists (
      select 1 from public.home_checks hc where hc.landlord_id = p_landlord_id
    ) then
      return true;
    end if;
  end if;

  if to_regclass('public.unit_inspections') is not null then
    if exists (
      select 1 from public.unit_inspections ui where ui.landlord_id = p_landlord_id
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

comment on function public.onboarding_inventory_has_unsafe_ops(uuid) is
  'True when Limited Alpha fresh Start must not wipe inventory (live tickets/ops). Import-lineage tickets are ignored via workflow_runs.metadata.source.';
