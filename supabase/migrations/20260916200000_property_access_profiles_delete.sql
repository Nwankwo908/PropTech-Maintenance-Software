-- Property access can be saved/updated, but RLS had no DELETE policy, so the
-- dashboard Delete button left the row in place and the section came back.

create policy property_access_profiles_delete_authenticated
  on public.property_access_profiles
  for delete
  to authenticated
  using (true);
