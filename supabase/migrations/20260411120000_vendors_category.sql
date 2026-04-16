-- Optional vendor grouping (e.g. trade / specialty) for admin UI.
alter table public.vendors
  add column if not exists category text;

comment on column public.vendors.category is
  'Optional label grouping the vendor (e.g. plumbing, electrical).';
