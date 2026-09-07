-- Account-level visitor attribution on landlords (canonical customer account).
-- Nullable so existing rows stay valid. First-touch is write-once at the database.

alter table public.landlords
  add column if not exists acquisition_source text,
  add column if not exists acquisition_medium text,
  add column if not exists acquisition_campaign text,
  add column if not exists acquisition_content text,
  add column if not exists acquisition_term text,
  add column if not exists acquisition_first_touch_at timestamptz,
  add column if not exists latest_acquisition_source text,
  add column if not exists latest_acquisition_medium text,
  add column if not exists latest_acquisition_campaign text,
  add column if not exists latest_acquisition_content text,
  add column if not exists latest_acquisition_term text,
  add column if not exists acquisition_latest_touch_at timestamptz;

comment on column public.landlords.acquisition_source is
  'First-touch UTM source. Write-once once populated.';
comment on column public.landlords.acquisition_medium is
  'First-touch UTM medium. Write-once once populated.';
comment on column public.landlords.acquisition_campaign is
  'First-touch UTM campaign. Write-once once populated.';
comment on column public.landlords.acquisition_content is
  'First-touch UTM content. Write-once once populated.';
comment on column public.landlords.acquisition_term is
  'First-touch UTM term. Write-once once populated.';
comment on column public.landlords.acquisition_first_touch_at is
  'When first-touch attribution was first stored. Write-once once populated.';
comment on column public.landlords.latest_acquisition_source is
  'Latest-touch UTM source. May update when a new campaign arrives.';
comment on column public.landlords.latest_acquisition_medium is
  'Latest-touch UTM medium. May update when a new campaign arrives.';
comment on column public.landlords.latest_acquisition_campaign is
  'Latest-touch UTM campaign. May update when a new campaign arrives.';
comment on column public.landlords.latest_acquisition_content is
  'Latest-touch UTM content. May update when a new campaign arrives.';
comment on column public.landlords.latest_acquisition_term is
  'Latest-touch UTM term. May update when a new campaign arrives.';
comment on column public.landlords.acquisition_latest_touch_at is
  'When latest-touch attribution was last stored.';

create or replace function public.landlords_protect_first_touch_attribution()
returns trigger
language plpgsql
as $$
begin
  if old.acquisition_source is not null then
    new.acquisition_source := old.acquisition_source;
  end if;
  if old.acquisition_medium is not null then
    new.acquisition_medium := old.acquisition_medium;
  end if;
  if old.acquisition_campaign is not null then
    new.acquisition_campaign := old.acquisition_campaign;
  end if;
  if old.acquisition_content is not null then
    new.acquisition_content := old.acquisition_content;
  end if;
  if old.acquisition_term is not null then
    new.acquisition_term := old.acquisition_term;
  end if;
  if old.acquisition_first_touch_at is not null then
    new.acquisition_first_touch_at := old.acquisition_first_touch_at;
  elsif new.acquisition_source is not null
     or new.acquisition_medium is not null
     or new.acquisition_campaign is not null
     or new.acquisition_content is not null
     or new.acquisition_term is not null then
    new.acquisition_first_touch_at := coalesce(new.acquisition_first_touch_at, now());
  end if;

  if (new.latest_acquisition_source is distinct from old.latest_acquisition_source)
     or (new.latest_acquisition_medium is distinct from old.latest_acquisition_medium)
     or (new.latest_acquisition_campaign is distinct from old.latest_acquisition_campaign)
     or (new.latest_acquisition_content is distinct from old.latest_acquisition_content)
     or (new.latest_acquisition_term is distinct from old.latest_acquisition_term) then
    new.acquisition_latest_touch_at := coalesce(new.acquisition_latest_touch_at, now());
  end if;

  return new;
end;
$$;

comment on function public.landlords_protect_first_touch_attribution() is
  'Keeps first-touch acquisition columns immutable once set. Latest-touch may change.';

drop trigger if exists landlords_protect_first_touch_attribution_trg on public.landlords;
create trigger landlords_protect_first_touch_attribution_trg
  before update on public.landlords
  for each row
  execute function public.landlords_protect_first_touch_attribution();
