-- Private bucket for fast-track landlord onboarding uploads (previewable in Org Settings).
-- Also allow authenticated signed-URL reads for vendor verification documents.

insert into storage.buckets (id, name, public)
values ('landlord-onboarding-documents', 'landlord-onboarding-documents', false)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can read landlord onboarding documents"
  on storage.objects;
create policy "Authenticated users can read landlord onboarding documents"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'landlord-onboarding-documents');

drop policy if exists "Authenticated users can upload landlord onboarding documents"
  on storage.objects;
create policy "Authenticated users can upload landlord onboarding documents"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'landlord-onboarding-documents');

drop policy if exists "Authenticated users can update landlord onboarding documents"
  on storage.objects;
create policy "Authenticated users can update landlord onboarding documents"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'landlord-onboarding-documents');

drop policy if exists "Authenticated users can read vendor documents"
  on storage.objects;
create policy "Authenticated users can read vendor documents"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'vendor-documents');
