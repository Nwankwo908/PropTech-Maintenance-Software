-- Staff dashboards need vendor_status_events to compute avg response time in
-- vendor_operational_metrics / vendor_score_view (security_invoker views).

create policy vendor_status_events_select_staff
  on public.vendor_status_events
  for select
  to authenticated
  using (public.is_staff_admin());

comment on policy vendor_status_events_select_staff on public.vendor_status_events is
  'Admin vendor score views read accept/decline timing for avg response time.';
