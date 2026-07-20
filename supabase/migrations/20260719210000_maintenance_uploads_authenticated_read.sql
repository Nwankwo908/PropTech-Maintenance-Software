-- Allow signed URL generation for maintenance request photos in the admin UI.
-- Bucket stays private; objects are only reachable via short-lived signed URLs.
-- Edge functions continue to use the service role (bypasses RLS).

create policy "Authenticated users can read maintenance uploads"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'maintenance-uploads');
