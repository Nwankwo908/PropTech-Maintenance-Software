-- Allow staff admins (demo / new landlord onboarding) to seed maintenance tickets
-- and workflow runs from the client-side fast-track import flow.

create policy maintenance_requests_insert_staff
  on public.maintenance_requests
  for insert
  to authenticated
  with check (public.is_staff_admin());

create policy workflow_runs_insert_staff
  on public.workflow_runs
  for insert
  to authenticated
  with check (public.is_staff_admin());

create policy workflow_events_insert_staff
  on public.workflow_events
  for insert
  to authenticated
  with check (public.is_staff_admin());
