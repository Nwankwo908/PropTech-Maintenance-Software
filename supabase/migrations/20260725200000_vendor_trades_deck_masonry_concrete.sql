-- Expand vendors.category taxonomy: deck_builder, masonry, concrete.
-- Keep in sync with src/lib/vendorTrades.ts / supabase/functions/_shared/vendor_trades.ts

alter table public.vendors drop constraint if exists vendors_category_check;

alter table public.vendors
  add constraint vendors_category_check
  check (
    category is null
    or category in (
      'appliance_repair',
      'carpentry',
      'cleaning',
      'concrete',
      'deck_builder',
      'electrical',
      'flooring',
      'general',
      'hvac',
      'landscaping',
      'locksmith',
      'masonry',
      'painting',
      'pest_control',
      'plumbing',
      'roofing',
      'windows',
      'other'
    )
  );

comment on column public.vendors.category is
  'Normalized vendor trade slug (appliance_repair, carpentry, concrete, deck_builder, masonry, plumbing, general, …). See vendorTrades taxonomy.';
