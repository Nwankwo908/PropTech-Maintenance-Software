-- W-9 tax profile on vendor verification:
-- entity type drives TIN type (SSN vs EIN), W-9 variant, and 1099 treatment.
-- Full TIN is never stored — only last4 + SHA-256 fingerprint.

alter table public.vendor_verifications
  add column if not exists tax_entity_type text,
  add column if not exists tin_type text,
  add column if not exists tin_last4 text,
  add column if not exists tin_fingerprint text,
  add column if not exists w9_variant text,
  add column if not exists tax_1099_treatment text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vendor_verifications_tax_entity_type_check'
  ) then
    alter table public.vendor_verifications
      add constraint vendor_verifications_tax_entity_type_check
      check (
        tax_entity_type is null
        or tax_entity_type in (
          'sole_proprietor',
          'llc',
          'corporation',
          'partnership',
          'other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vendor_verifications_tin_type_check'
  ) then
    alter table public.vendor_verifications
      add constraint vendor_verifications_tin_type_check
      check (tin_type is null or tin_type in ('ssn', 'ein'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vendor_verifications_w9_variant_check'
  ) then
    alter table public.vendor_verifications
      add constraint vendor_verifications_w9_variant_check
      check (w9_variant is null or w9_variant in ('individual', 'business'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vendor_verifications_tax_1099_treatment_check'
  ) then
    alter table public.vendor_verifications
      add constraint vendor_verifications_tax_1099_treatment_check
      check (
        tax_1099_treatment is null
        or tax_1099_treatment in ('nec', 'none')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vendor_verifications_tin_last4_check'
  ) then
    alter table public.vendor_verifications
      add constraint vendor_verifications_tin_last4_check
      check (tin_last4 is null or tin_last4 ~ '^[0-9]{4}$');
  end if;
end $$;

comment on column public.vendor_verifications.tax_entity_type is
  'Legal entity on W-9: sole_proprietor | llc | corporation | partnership | other.';
comment on column public.vendor_verifications.tin_type is
  'TIN kind required by entity: ssn (sole prop) or ein (LLC/corp/etc).';
comment on column public.vendor_verifications.tin_last4 is
  'Last 4 digits of SSN/EIN for display; full TIN is not retained.';
comment on column public.vendor_verifications.tin_fingerprint is
  'SHA-256 hex of normalized TIN digits (no plaintext TIN stored).';
comment on column public.vendor_verifications.w9_variant is
  'W-9 form variant: individual (sole prop) or business.';
comment on column public.vendor_verifications.tax_1099_treatment is
  '1099 treatment: nec (issue 1099-NEC) or none (e.g. corporation).';
