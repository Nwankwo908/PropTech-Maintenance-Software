-- Account privacy ownership (reviewed).
--
-- Closes remaining cross-tenant gaps after landlord-scoped RLS:
-- 1) Explicitly drop legacy public.users *_all policies (anon/authenticated using true).
-- 2) Scope landlord_portal_members to can_access_landlord (was is_staff_admin only,
--    which includes every portal email and allowed membership writes across accounts).
-- 3) Private storage: require first path segment = accessible landlord_id for
--    landlord-onboarding-documents + inspection-uploads; remove bucket-wide
--    authenticated reads on maintenance-uploads / vendor-documents (signed URLs
--    remain bearer links via service-role minting after caller auth).
-- 4) Prevent landlord_id reassignment on portfolio rows via BEFORE UPDATE trigger.
--
-- Does not widen is_staff_admin(). Portal emails remain "staff UI" capable, but
-- data policies must use can_access_landlord / is_platform_staff, not is_staff_admin alone.

-- ---------------------------------------------------------------------------
-- 1. Drop permissive public.users policies (idempotent)
-- ---------------------------------------------------------------------------

drop policy if exists users_select_all on public.users;
drop policy if exists users_insert_all on public.users;
drop policy if exists users_update_all on public.users;
drop policy if exists users_delete_all on public.users;

-- Re-assert landlord-scoped users policies (authenticated only).
drop policy if exists users_select_landlord_scoped on public.users;
drop policy if exists users_insert_landlord_scoped on public.users;
drop policy if exists users_update_landlord_scoped on public.users;
drop policy if exists users_delete_landlord_scoped on public.users;

create policy users_select_landlord_scoped
  on public.users for select to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or lower(email) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );

create policy users_insert_landlord_scoped
  on public.users for insert to authenticated
  with check (public.can_access_landlord(landlord_id));

-- Landlords may update residents on their account. A resident JWT matching
-- email may update their own row but cannot change landlord_id (trigger + check).
create policy users_update_landlord_scoped
  on public.users for update to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or lower(email) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
  with check (
    public.can_access_landlord(landlord_id)
    or (
      lower(email) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      and landlord_id is not distinct from (
        select u.landlord_id
        from public.users u
        where lower(u.email) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
        limit 1
      )
    )
  );

create policy users_delete_landlord_scoped
  on public.users for delete to authenticated
  using (public.can_access_landlord(landlord_id));

-- ---------------------------------------------------------------------------
-- 2. landlord_portal_members — ownership, no self-escalation across accounts
-- ---------------------------------------------------------------------------

drop policy if exists landlord_portal_members_staff_all on public.landlord_portal_members;
drop policy if exists landlord_portal_members_select_scoped on public.landlord_portal_members;
drop policy if exists landlord_portal_members_insert_scoped on public.landlord_portal_members;
drop policy if exists landlord_portal_members_update_scoped on public.landlord_portal_members;
drop policy if exists landlord_portal_members_delete_scoped on public.landlord_portal_members;

create policy landlord_portal_members_select_scoped
  on public.landlord_portal_members for select to authenticated
  using (
    public.can_access_landlord(landlord_id)
    or lower(email) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );

create policy landlord_portal_members_insert_scoped
  on public.landlord_portal_members for insert to authenticated
  with check (public.can_access_landlord(landlord_id));

create policy landlord_portal_members_update_scoped
  on public.landlord_portal_members for update to authenticated
  using (public.can_access_landlord(landlord_id))
  with check (public.can_access_landlord(landlord_id));

create policy landlord_portal_members_delete_scoped
  on public.landlord_portal_members for delete to authenticated
  using (public.can_access_landlord(landlord_id));

-- ---------------------------------------------------------------------------
-- 3. Prevent landlord_id reassignment on portfolio tables
-- ---------------------------------------------------------------------------

create or replace function public.prevent_landlord_id_reassignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.landlord_id is distinct from old.landlord_id then
    raise exception 'landlord_id reassignment is not allowed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.prevent_landlord_id_reassignment() is
  'Rejects UPDATE that moves a row to a different landlord_id.';

do $$
declare
  t text;
  tables text[] := array[
    'properties',
    'units',
    'users',
    'maintenance_requests',
    'occupancy',
    'vendors'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'drop trigger if exists trg_prevent_landlord_id_reassignment on public.%I',
      t
    );
    execute format(
      'create trigger trg_prevent_landlord_id_reassignment
         before update of landlord_id on public.%I
         for each row
         execute function public.prevent_landlord_id_reassignment()',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Storage ownership helpers + policies
-- ---------------------------------------------------------------------------

create or replace function public.storage_path_landlord_id(object_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when split_part(coalesce(object_name, ''), '/', 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

comment on function public.storage_path_landlord_id(text) is
  'First path segment when it is a UUID (landlord-owned object layout).';

revoke all on function public.storage_path_landlord_id(text) from public;
grant execute on function public.storage_path_landlord_id(text) to authenticated;

create or replace function public.can_access_storage_landlord_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.can_access_landlord(public.storage_path_landlord_id(object_name));
$$;

revoke all on function public.can_access_storage_landlord_path(text) from public;
grant execute on function public.can_access_storage_landlord_path(text) to authenticated;

-- landlord-onboarding-documents
drop policy if exists "Authenticated users can read landlord onboarding documents"
  on storage.objects;
drop policy if exists "Authenticated users can upload landlord onboarding documents"
  on storage.objects;
drop policy if exists "Authenticated users can update landlord onboarding documents"
  on storage.objects;
drop policy if exists landlord_onboarding_docs_select_owned on storage.objects;
drop policy if exists landlord_onboarding_docs_insert_owned on storage.objects;
drop policy if exists landlord_onboarding_docs_update_owned on storage.objects;
drop policy if exists landlord_onboarding_docs_delete_owned on storage.objects;

create policy landlord_onboarding_docs_select_owned
  on storage.objects for select to authenticated
  using (
    bucket_id = 'landlord-onboarding-documents'
    and public.can_access_storage_landlord_path(name)
  );

create policy landlord_onboarding_docs_insert_owned
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'landlord-onboarding-documents'
    and public.can_access_storage_landlord_path(name)
  );

create policy landlord_onboarding_docs_update_owned
  on storage.objects for update to authenticated
  using (
    bucket_id = 'landlord-onboarding-documents'
    and public.can_access_storage_landlord_path(name)
  )
  with check (
    bucket_id = 'landlord-onboarding-documents'
    and public.can_access_storage_landlord_path(name)
  );

create policy landlord_onboarding_docs_delete_owned
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'landlord-onboarding-documents'
    and public.can_access_storage_landlord_path(name)
  );

-- inspection-uploads (paths: {landlord_id}/...)
drop policy if exists "Authenticated users can read inspection uploads"
  on storage.objects;
drop policy if exists inspection_uploads_select_owned on storage.objects;
drop policy if exists inspection_uploads_insert_owned on storage.objects;
drop policy if exists inspection_uploads_update_owned on storage.objects;
drop policy if exists inspection_uploads_delete_owned on storage.objects;

create policy inspection_uploads_select_owned
  on storage.objects for select to authenticated
  using (
    bucket_id = 'inspection-uploads'
    and public.can_access_storage_landlord_path(name)
  );

create policy inspection_uploads_insert_owned
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inspection-uploads'
    and public.can_access_storage_landlord_path(name)
  );

create policy inspection_uploads_update_owned
  on storage.objects for update to authenticated
  using (
    bucket_id = 'inspection-uploads'
    and public.can_access_storage_landlord_path(name)
  )
  with check (
    bucket_id = 'inspection-uploads'
    and public.can_access_storage_landlord_path(name)
  );

create policy inspection_uploads_delete_owned
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'inspection-uploads'
    and public.can_access_storage_landlord_path(name)
  );

-- maintenance-uploads + vendor-documents: drop bucket-wide authenticated access.
-- Reads/writes go through Edge (service role) or short-lived signed URLs (bearer).
drop policy if exists "Authenticated users can read maintenance uploads"
  on storage.objects;
drop policy if exists "Authenticated users can read vendor documents"
  on storage.objects;

-- Vendor docs owned via verification id prefix → join to landlord when possible.
drop policy if exists vendor_documents_select_owned on storage.objects;
create policy vendor_documents_select_owned
  on storage.objects for select to authenticated
  using (
    bucket_id = 'vendor-documents'
    and exists (
      select 1
      from public.vendor_verifications vv
      where vv.id::text = split_part(name, '/', 1)
        and public.can_access_landlord(vv.landlord_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Linked FK ownership helpers (tickets must match property landlord)
-- ---------------------------------------------------------------------------

create or replace function public.property_belongs_to_landlord(
  p_property_id uuid,
  p_landlord_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and p.landlord_id = p_landlord_id
  );
$$;

revoke all on function public.property_belongs_to_landlord(uuid, uuid) from public;
grant execute on function public.property_belongs_to_landlord(uuid, uuid) to authenticated;

create or replace function public.enforce_maintenance_request_landlord_links()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.property_id is not null
     and not public.property_belongs_to_landlord(new.property_id, new.landlord_id) then
    raise exception 'maintenance_requests.property_id must belong to the same landlord'
      using errcode = '23514';
  end if;
  if new.resident_id is not null then
    if not exists (
      select 1
      from public.users u
      where u.id = new.resident_id
        and u.landlord_id = new.landlord_id
    ) then
      raise exception 'maintenance_requests.resident_id must belong to the same landlord'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_maintenance_request_landlord_links
  on public.maintenance_requests;
create trigger trg_enforce_maintenance_request_landlord_links
  before insert or update of landlord_id, property_id, resident_id
  on public.maintenance_requests
  for each row
  execute function public.enforce_maintenance_request_landlord_links();
