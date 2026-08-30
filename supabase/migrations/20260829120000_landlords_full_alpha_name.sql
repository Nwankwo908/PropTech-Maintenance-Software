-- Rename the production landlord account label Alpha → Full Alpha.

update public.landlords
set name = 'Full Alpha'
where id = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
  and name = 'Alpha';
