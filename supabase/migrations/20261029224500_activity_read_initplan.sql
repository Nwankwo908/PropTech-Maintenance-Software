-- Cross-account Overview counts were timing out because the read rule called
-- access checks row by row. Hoist the caller's landlord list once.

drop policy if exists property_operations_graph_select_account on public.property_operations_graph;
create policy property_operations_graph_select_account
  on public.property_operations_graph
  for select
  to authenticated
  using (
    landlord_id in (select public.accessible_landlord_ids())
    or (select public.is_platform_staff())
  );
