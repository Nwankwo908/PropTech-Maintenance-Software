-- Ask Ulo: source refresh cadence — check each official feed as often as it changes.
-- Federal/state/court: daily. Published city/county codes: weekly.
-- Council/clerk announcements: daily (pending ordinances). HUD: publisher schedule.
-- Equipment manuals: on manufacturer release only.

-- ---------------------------------------------------------------------------
-- ask_ulo_source_feeds — official feed registry (prefer .gov / HUD APIs)
-- ---------------------------------------------------------------------------
create table if not exists public.ask_ulo_source_feeds (
  id uuid primary key default gen_random_uuid(),
  feed_key text not null unique,
  label text not null,
  feed_kind text not null
    check (
      feed_kind in (
        'federal_law',
        'state_law',
        'municipal_code_published',
        'municipal_pending_announcements',
        'court_opinions',
        'hud_dataset',
        'equipment_manual',
        'agency_guidance'
      )
    ),
  -- How often Ulo should check this official source
  refresh_cadence text not null
    check (
      refresh_cadence in (
        'daily',
        'weekly',
        'on_publisher_schedule',
        'on_manufacturer_release'
      )
    ),
  country_code text not null default 'US',
  state_code text,
  county_slug text,
  city_slug text,
  document_type text,
  -- Official source only (not aggregators)
  official_url text not null,
  official_api_url text,
  publisher_name text,
  publisher_schedule_note text,
  last_checked_at timestamptz,
  last_change_detected_at timestamptz,
  next_check_at timestamptz not null default now(),
  last_check_status text
    check (
      last_check_status is null
      or last_check_status in ('ok', 'changed', 'unchanged', 'error', 'skipped')
    ),
  last_check_error text,
  last_etag text,
  last_modified_header text,
  content_fingerprint text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ask_ulo_source_feeds is
  'Ask Ulo official source feeds with refresh cadence. Prefer government/HUD APIs over third-party mirrors.';

create index if not exists ask_ulo_source_feeds_due_idx
  on public.ask_ulo_source_feeds (next_check_at)
  where enabled = true;

create index if not exists ask_ulo_source_feeds_kind_idx
  on public.ask_ulo_source_feeds (feed_kind, state_code);

alter table public.ask_ulo_source_feeds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ask_ulo_source_feeds'
      and policyname = 'ask_ulo_source_feeds_staff_select'
  ) then
    create policy ask_ulo_source_feeds_staff_select
      on public.ask_ulo_source_feeds
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

grant select on public.ask_ulo_source_feeds to authenticated, service_role;
grant all on public.ask_ulo_source_feeds to service_role;

-- ---------------------------------------------------------------------------
-- legal_rag_chunks — per-chunk refresh tracking tied to a feed
-- ---------------------------------------------------------------------------
alter table public.legal_rag_chunks
  add column if not exists refresh_cadence text,
  add column if not exists source_feed_id uuid references public.ask_ulo_source_feeds (id),
  add column if not exists source_checked_at timestamptz,
  add column if not exists next_check_at timestamptz;

alter table public.legal_rag_chunks
  drop constraint if exists legal_rag_chunks_refresh_cadence_check;

alter table public.legal_rag_chunks
  add constraint legal_rag_chunks_refresh_cadence_check
  check (
    refresh_cadence is null
    or refresh_cadence in (
      'daily',
      'weekly',
      'on_publisher_schedule',
      'on_manufacturer_release'
    )
  );

comment on column public.legal_rag_chunks.refresh_cadence is
  'How often this chunk''s official source should be re-checked (mirrors feed policy).';

comment on column public.legal_rag_chunks.source_checked_at is
  'When Ulo last verified this chunk against the official source.';

create index if not exists legal_rag_chunks_next_check_idx
  on public.legal_rag_chunks (next_check_at)
  where next_check_at is not null;

-- Backfill cadence from passport document_type
update public.legal_rag_chunks
set refresh_cadence = coalesce(
  refresh_cadence,
  case document_type
    when 'statute' then 'daily'
    when 'regulation' then 'daily'
    when 'court_opinion' then 'daily'
    when 'municipal_code' then 'weekly'
    when 'building_code' then 'weekly'
    when 'housing_program_rule' then 'on_publisher_schedule'
    when 'agency_guidance' then 'on_publisher_schedule'
    when 'government_guide' then 'on_publisher_schedule'
    when 'maintenance_manual' then 'on_manufacturer_release'
    else 'weekly'
  end
)
where refresh_cadence is null;

-- ---------------------------------------------------------------------------
-- Seed official feeds (OR / Portland demo + federal / HUD)
-- ---------------------------------------------------------------------------
insert into public.ask_ulo_source_feeds (
  feed_key, label, feed_kind, refresh_cadence,
  country_code, state_code, city_slug, document_type,
  official_url, official_api_url, publisher_name, publisher_schedule_note, metadata
) values
  (
    'us_federal_housing_law',
    'Federal housing statutes & regulations (eCFR / Congress.gov)',
    'federal_law',
    'daily',
    'US', null, null, 'statute',
    'https://www.ecfr.gov/',
    null,
    'U.S. Government Publishing Office / eCFR',
    'Check daily — federal rules can publish any business day.',
    '{"prefer_official":true}'::jsonb
  ),
  (
    'or_state_landlord_tenant',
    'Oregon Revised Statutes ch. 90 (Residential Landlord and Tenant)',
    'state_law',
    'daily',
    'US', 'OR', null, 'statute',
    'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
    null,
    'Oregon Legislative Assembly',
    'Daily while legislature is in session; daily year-round for codification lag.',
    '{"prefer_official":true}'::jsonb
  ),
  (
    'portland_code_published',
    'City of Portland online code (published)',
    'municipal_code_published',
    'weekly',
    'US', 'OR', 'portland', 'municipal_code',
    'https://www.portland.gov/code',
    null,
    'City of Portland',
    'Published code: weekly. Pair with pending announcements feed.',
    '{"prefer_official":true}'::jsonb
  ),
  (
    'portland_council_clerk_announcements',
    'Portland City Council / Auditor clerk announcements (pending ordinances)',
    'municipal_pending_announcements',
    'daily',
    'US', 'OR', 'portland', 'municipal_code',
    'https://www.portland.gov/council',
    null,
    'City of Portland Auditor / Council Clerk',
    'Daily — ordinances often pass before online code updates.',
    '{"prefer_official":true,"publication_status":"adopted_not_yet_codified"}'::jsonb
  ),
  (
    'or_courts_opinions',
    'Oregon appellate court opinions',
    'court_opinions',
    'daily',
    'US', 'OR', null, 'court_opinion',
    'https://www.courts.oregon.gov/publications/Pages/default.aspx',
    null,
    'Oregon Judicial Department',
    'Daily so answers use latest holdings.',
    '{"prefer_official":true}'::jsonb
  ),
  (
    'hud_fmr',
    'HUD Fair Market Rents',
    'hud_dataset',
    'on_publisher_schedule',
    'US', null, null, 'government_guide',
    'https://www.huduser.gov/portal/datasets/fmr.html',
    'https://www.huduser.gov/hudapi/public/fmr',
    'U.S. Department of Housing and Urban Development',
    'Update when HUD releases the fiscal-year FMR dataset (typically annual).',
    '{"prefer_official":true,"dataset":"fmr"}'::jsonb
  ),
  (
    'hud_income_limits',
    'HUD Income Limits',
    'hud_dataset',
    'on_publisher_schedule',
    'US', null, null, 'government_guide',
    'https://www.huduser.gov/portal/datasets/il.html',
    'https://www.huduser.gov/hudapi/public/il',
    'U.S. Department of Housing and Urban Development',
    'Update when HUD releases new income limits.',
    '{"prefer_official":true,"dataset":"income_limits"}'::jsonb
  ),
  (
    'equipment_manuals_on_release',
    'Manufacturer equipment manuals & technical bulletins',
    'equipment_manual',
    'on_manufacturer_release',
    'US', null, null, 'maintenance_manual',
    'https://www.portland.gov/',
    null,
    'Equipment manufacturers',
    'Only when manufacturer publishes a new manual version or bulletin (event-driven).',
    '{"prefer_official":true,"event_driven":true}'::jsonb
  )
on conflict (feed_key) do update set
  label = excluded.label,
  feed_kind = excluded.feed_kind,
  refresh_cadence = excluded.refresh_cadence,
  official_url = excluded.official_url,
  official_api_url = excluded.official_api_url,
  publisher_name = excluded.publisher_name,
  publisher_schedule_note = excluded.publisher_schedule_note,
  metadata = excluded.metadata,
  updated_at = now();

-- Link demo chunks to feeds where passport matches
update public.legal_rag_chunks c
set source_feed_id = f.id
from public.ask_ulo_source_feeds f
where c.source_feed_id is null
  and coalesce(c.metadata->>'demo', 'false') = 'true'
  and (
    (f.feed_key = 'or_state_landlord_tenant'
      and c.state_code = 'OR'
      and c.document_type = 'statute'
      and c.jurisdiction_level = 'state')
    or (f.feed_key = 'us_federal_housing_law'
      and c.jurisdiction_level = 'federal'
      and c.document_type in ('statute', 'regulation'))
    or (f.feed_key = 'portland_code_published'
      and c.city_slug = 'portland'
      and c.document_type = 'municipal_code'
      and coalesce(c.publication_status, 'published_code') = 'published_code')
    or (f.feed_key = 'portland_council_clerk_announcements'
      and c.city_slug = 'portland'
      and c.publication_status = 'adopted_not_yet_codified')
    or (f.feed_key = 'or_courts_opinions'
      and c.document_type = 'court_opinion'
      and c.state_code = 'OR')
    or (f.feed_key = 'hud_fmr'
      and c.domain = 'finance'
      and coalesce(c.source_citation, '') ilike '%fmr%')
  );

-- ---------------------------------------------------------------------------
-- list_ask_ulo_source_feeds_due — cron helper
-- ---------------------------------------------------------------------------
create or replace function public.list_ask_ulo_source_feeds_due(
  limit_count int default 25
)
returns setof public.ask_ulo_source_feeds
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.ask_ulo_source_feeds
  where enabled = true
    and next_check_at <= now()
    -- Event-driven manuals are claimed only when next_check_at was advanced
    and refresh_cadence is distinct from 'on_manufacturer_release'
  order by next_check_at asc
  limit greatest(1, least(coalesce(limit_count, 25), 100));
$$;

comment on function public.list_ask_ulo_source_feeds_due is
  'Ask Ulo: official source feeds whose next_check_at is due (excludes idle manufacturer event feeds).';

grant execute on function public.list_ask_ulo_source_feeds_due(int) to service_role;
