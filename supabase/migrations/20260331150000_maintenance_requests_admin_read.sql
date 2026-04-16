-- Allow authenticated users (e.g. staff signed in via Supabase Auth) to read tickets
-- for admin UIs. Inserts remain via Edge Function / service role.
-- Anonymous clients still cannot read rows unless you add a separate policy.

create policy "maintenance_requests_select_authenticated"
  on public.maintenance_requests
  for select
  to authenticated
  using (true);

-- Allow joins / embeds (e.g. `vendors(name)`) when listing tickets.
create policy "vendors_select_authenticated"
  on public.vendors
  for select
  to authenticated
  using (true);
