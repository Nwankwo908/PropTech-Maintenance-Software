-- Coalesce vendors.category to canonical trade slugs (appliance, plumbing, electrical) or NULL for generalists.
-- Unknown labels (e.g. HVAC) become NULL so they participate only as generalist fallback routing.

update public.vendors
set category = case
  when category is null or btrim(category) = '' then null
  when lower(btrim(category)) in (
    'general',
    'generalist',
    'general maintenance',
    'handyman',
    'other',
    'misc',
    'n/a',
    'na'
  ) then null
  when lower(btrim(category)) like '%appliance%' then 'appliance'
  when lower(btrim(category)) like '%plumb%' then 'plumbing'
  when lower(btrim(category)) like '%electric%' then 'electrical'
  else null
end;
