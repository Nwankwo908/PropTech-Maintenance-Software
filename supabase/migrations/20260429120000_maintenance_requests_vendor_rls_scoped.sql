-- Scope maintenance_requests SELECT for authenticated users:
-- - Staff (admin login domain) retain full read access.
-- - Vendor portal users only see tickets assigned to their vendor row (auth_user_id or email match).

drop policy if exists "maintenance_requests_select_authenticated" on public.maintenance_requests;

create policy "maintenance_requests_select_authenticated"
  on public.maintenance_requests
  for select
  to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') ilike '%@property-admin.auth.local'
    or assigned_vendor_id in (
      select v.id
      from public.vendors v
      where v.auth_user_id = auth.uid()
         or lower(trim(coalesce(v.email, ''))) = lower(trim(coalesce((auth.jwt() ->> 'email'), '')))
    )
  );
