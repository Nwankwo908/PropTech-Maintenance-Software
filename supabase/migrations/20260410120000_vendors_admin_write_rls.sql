-- Allow authenticated dashboard users to maintain vendor directory from the admin UI.
-- Inserts still respect table defaults (e.g. portal_api_key).

create policy "vendors_insert_authenticated"
  on public.vendors
  for insert
  to authenticated
  with check (true);

create policy "vendors_update_authenticated"
  on public.vendors
  for update
  to authenticated
  using (true)
  with check (true);
