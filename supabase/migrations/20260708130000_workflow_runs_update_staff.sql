-- Allow staff admins to resume escalated workflow runs from dashboard review rails.

create policy workflow_runs_update_staff
  on public.workflow_runs
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy operations_graph_events_insert_staff
  on public.operations_graph_events
  for insert
  to authenticated
  with check (public.is_staff_admin());
