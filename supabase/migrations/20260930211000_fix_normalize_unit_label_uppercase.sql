-- Follow-up: normalize_unit_label stripped A–Z before lower(), so letter unit
-- labels ("A","B") became '' and matched null ticket units ('' = ''). Lower
-- first, then strip non-alphanumerics. Reaffirm null-unit fail-closed on match.

create or replace function public.normalize_unit_label(label text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(lower(coalesce(trim(label), '')), '#|unit|apt', '', 'g'),
    '[^a-z0-9]',
    '',
    'g'
  );
$$;

comment on function public.normalize_unit_label(text) is
  'Normalize unit labels for matching. Lowercases first so letter-only labels (A/B) are preserved; strips unit/apt/# noise then non-alphanumerics.';

create or replace function public.maintenance_unit_label_match(mr_unit text, unit_label text)
returns boolean
language sql
immutable
as $$
  select case
    when nullif(trim(mr_unit), '') is null then false
    when nullif(trim(unit_label), '') is null then false
    when nullif(public.normalize_unit_label(unit_label), '') is null then false
    when nullif(public.normalize_unit_label(mr_unit), '') is null then false
    when public.normalize_unit_label(unit_label) = public.normalize_unit_label(mr_unit) then true
    when nullif(
      regexp_replace(
        regexp_replace(lower(trim(mr_unit)), '#|unit|apt', '', 'g'),
        '[^0-9]',
        '',
        'g'
      ),
      ''
    ) is not null
      and public.normalize_unit_label(unit_label) = nullif(
        regexp_replace(
          regexp_replace(lower(trim(mr_unit)), '#|unit|apt', '', 'g'),
          '[^0-9]',
          '',
          'g'
        ),
        ''
      )
    then true
    else false
  end;
$$;

comment on function public.maintenance_unit_label_match(text, text) is
  'True when a non-blank maintenance ticket unit string matches a units.unit_label (including building-prefixed labels). Null/blank ticket unit never matches; empty normalized labels never match.';
