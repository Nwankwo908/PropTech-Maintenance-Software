-- Normalize vendors.category to the standardized Ulo vendor trade taxonomy.
-- Canonical slugs: see src/lib/vendorTrades.ts / supabase/functions/_shared/vendor_trades.ts
-- Legacy values (appliance, null generalist, pest, etc.) map on read and here on write.

-- Remote DBs may still enforce the old plumbing/electrical/appliance-only check.
alter table public.vendors drop constraint if exists vendors_category_check;

update public.vendors
set category = case
  when category is null or btrim(category) = '' then 'general'
  when lower(btrim(category)) in (
    'general', 'generalist', 'general maintenance', 'handyman', 'household'
  ) then 'general'
  when lower(btrim(category)) in ('other', 'misc', 'n/a', 'na', 'maintenance') then 'other'
  when lower(btrim(category)) like '%appliance%' then 'appliance_repair'
  when lower(btrim(category)) like '%plumb%'
    or lower(btrim(category)) like '%water%'
    or lower(btrim(category)) like '%leak%' then 'plumbing'
  when lower(btrim(category)) like '%electric%' then 'electrical'
  when lower(btrim(category)) like '%hvac%'
    or lower(btrim(category)) like '%heat%'
    or lower(btrim(category)) like '%air condition%'
    or lower(btrim(category)) = 'ac' then 'hvac'
  when lower(btrim(category)) like '%pest%' then 'pest_control'
  when lower(btrim(category)) like '%clean%' then 'cleaning'
  when lower(btrim(category)) like '%landscap%'
    or lower(btrim(category)) like '%lawn%'
    or lower(btrim(category)) like '%exterior%'
    or lower(btrim(category)) like '%outside%' then 'landscaping'
  when lower(btrim(category)) like '%lock%' then 'locksmith'
  when lower(btrim(category)) like '%paint%' then 'painting'
  when lower(btrim(category)) like '%roof%' then 'roofing'
  when lower(btrim(category)) like '%window%'
    or lower(btrim(category)) like '%door%' then 'windows'
  when lower(btrim(category)) like '%carpent%' then 'carpentry'
  when lower(btrim(category)) like '%floor%' then 'flooring'
  when lower(btrim(replace(category, ' ', '_'))) in (
    'appliance_repair', 'carpentry', 'cleaning', 'electrical', 'flooring',
    'general', 'hvac', 'landscaping', 'locksmith', 'painting', 'pest_control',
    'plumbing', 'roofing', 'windows', 'other'
  ) then lower(btrim(replace(category, ' ', '_')))
  else 'other'
end
where true;

alter table public.vendors
  add constraint vendors_category_check
  check (
    category is null
    or category in (
      'appliance_repair',
      'carpentry',
      'cleaning',
      'electrical',
      'flooring',
      'general',
      'hvac',
      'landscaping',
      'locksmith',
      'painting',
      'pest_control',
      'plumbing',
      'roofing',
      'windows',
      'other'
    )
  );

comment on column public.vendors.category is
  'Normalized vendor trade slug (appliance_repair, plumbing, electrical, hvac, general, …). See vendorTrades taxonomy.';

-- Align ticket issue_category legacy appliance → appliance_repair where exact match.
update public.maintenance_requests
set issue_category = 'appliance_repair'
where lower(btrim(coalesce(issue_category, ''))) in ('appliance', 'appliances');
