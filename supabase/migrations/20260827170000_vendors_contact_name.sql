-- Contact person on the vendor roster (Edit Vendor rail).

alter table public.vendors
  add column if not exists contact_name text;

comment on column public.vendors.contact_name is
  'Primary contact person for this vendor, collected on Add/Edit Vendor.';
