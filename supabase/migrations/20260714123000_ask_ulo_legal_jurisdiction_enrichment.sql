-- Ask Ulo: richer legal jurisdiction + currency metadata.
-- Extends federal/state/city with country, county, court, housing program,
-- code set, effective dates, and published vs pending-ordinance publication status.

-- ---------------------------------------------------------------------------
-- legal_rag_chunks — jurisdiction + currency columns
-- ---------------------------------------------------------------------------
alter table public.legal_rag_chunks
  drop constraint if exists legal_rag_chunks_jurisdiction_level_check;

alter table public.legal_rag_chunks
  add constraint legal_rag_chunks_jurisdiction_level_check
  check (jurisdiction_level in ('federal', 'state', 'county', 'city'));

alter table public.legal_rag_chunks
  add column if not exists country_code text not null default 'US',
  add column if not exists county_slug text,
  add column if not exists county_label text,
  add column if not exists court_system text,
  add column if not exists housing_program text,
  add column if not exists code_set text,
  add column if not exists normative_type text
    check (normative_type is null or normative_type in ('requirement', 'guidance')),
  add column if not exists publication_status text not null default 'published_code'
    check (
      publication_status in (
        'published_code',
        'adopted_not_yet_codified',
        'agency_guidance'
      )
    ),
  add column if not exists effective_on date,
  add column if not exists repealed_on date,
  add column if not exists adopted_on date;

comment on column public.legal_rag_chunks.publication_status is
  'published_code = current online code; adopted_not_yet_codified = council-passed ordinance not yet in Municode/online code; agency_guidance = non-binding.';

comment on column public.legal_rag_chunks.normative_type is
  'requirement = hard legal obligation; guidance = recommendation / agency FAQ.';

create index if not exists legal_rag_chunks_county_idx
  on public.legal_rag_chunks (state_code, county_slug);

create index if not exists legal_rag_chunks_publication_idx
  on public.legal_rag_chunks (publication_status, effective_on);

-- ---------------------------------------------------------------------------
-- match_legal_rag_chunks — prefer pending ordinances; optional county filter
-- ---------------------------------------------------------------------------
drop function if exists public.match_legal_rag_chunks(
  extensions.vector,
  int,
  text,
  text,
  text
);

create or replace function public.match_legal_rag_chunks(
  query_embedding extensions.vector(1536),
  match_count int default 6,
  filter_state_code text default null,
  filter_city_slug text default null,
  domain_filter text default null,
  filter_county_slug text default null,
  filter_country_code text default 'US'
)
returns table (
  id uuid,
  jurisdiction_level text,
  country_code text,
  state_code text,
  county_slug text,
  city_slug text,
  domain text,
  source_title text,
  source_citation text,
  source_url text,
  chunk_text text,
  metadata jsonb,
  publication_status text,
  normative_type text,
  effective_on date,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.jurisdiction_level,
    c.country_code,
    c.state_code,
    c.county_slug,
    c.city_slug,
    c.domain,
    c.source_title,
    c.source_citation,
    c.source_url,
    c.chunk_text,
    c.metadata,
    c.publication_status,
    c.normative_type,
    c.effective_on,
    (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.legal_rag_chunks c
  where c.embedding is not null
    and (
      filter_country_code is null
      or upper(c.country_code) = upper(filter_country_code)
    )
    and (
      c.jurisdiction_level = 'federal'
      or (
        filter_state_code is not null
        and upper(c.state_code) = upper(filter_state_code)
        and (
          c.county_slug is null
          or filter_county_slug is null
          or lower(c.county_slug) = lower(filter_county_slug)
        )
        and (
          c.city_slug is null
          or filter_city_slug is null
          or lower(c.city_slug) = lower(filter_city_slug)
        )
      )
    )
    and (
      domain_filter is null
      or c.domain = domain_filter
    )
    and (c.repealed_on is null or c.repealed_on > current_date)
  order by
    -- Prefer newly adopted ordinances that may not yet appear in online codes.
    case c.publication_status
      when 'adopted_not_yet_codified' then 0
      when 'published_code' then 1
      else 2
    end,
    c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 6), 20));
$$;

comment on function public.match_legal_rag_chunks is
  'Ask Ulo legal RAG: country/state/county/city filter, prefer pending ordinances, then cosine similarity.';

grant execute on function public.match_legal_rag_chunks(
  extensions.vector,
  int,
  text,
  text,
  text,
  text,
  text
) to service_role;

grant execute on function public.match_legal_rag_chunks(
  extensions.vector,
  int,
  text,
  text,
  text,
  text,
  text
) to authenticated;

-- ---------------------------------------------------------------------------
-- compliance_structured_facts — same jurisdiction dimensions
-- ---------------------------------------------------------------------------
alter table public.compliance_structured_facts
  drop constraint if exists compliance_structured_facts_jurisdiction_level_check;

alter table public.compliance_structured_facts
  add constraint compliance_structured_facts_jurisdiction_level_check
  check (jurisdiction_level in ('federal', 'state', 'county', 'city'));

alter table public.compliance_structured_facts
  add column if not exists country_code text not null default 'US',
  add column if not exists county_slug text,
  add column if not exists county_label text,
  add column if not exists court_system text,
  add column if not exists housing_program text,
  add column if not exists code_set text,
  add column if not exists normative_type text
    check (normative_type is null or normative_type in ('requirement', 'guidance')),
  add column if not exists publication_status text not null default 'published_code'
    check (
      publication_status in (
        'published_code',
        'adopted_not_yet_codified',
        'agency_guidance'
      )
    ),
  add column if not exists repealed_on date,
  add column if not exists adopted_on date;

create index if not exists compliance_structured_facts_county_idx
  on public.compliance_structured_facts (state_code, county_slug);

-- ---------------------------------------------------------------------------
-- Demo enrichment: county / court / code on existing Portland chunks +
-- one pending ordinance (adopted, not yet in published online code).
-- ---------------------------------------------------------------------------
update public.legal_rag_chunks
set
  country_code = 'US',
  county_slug = 'multnomah',
  county_label = 'Multnomah',
  court_system = 'Oregon Circuit Court (Multnomah County)',
  code_set = 'Portland Title 29 / IPMC-aligned housing code',
  normative_type = coalesce(normative_type, 'requirement'),
  publication_status = coalesce(publication_status, 'published_code')
where state_code = 'OR'
  and city_slug = 'portland'
  and coalesce(metadata->>'demo', 'false') = 'true';

update public.legal_rag_chunks
set
  country_code = 'US',
  court_system = 'Oregon Circuit Court',
  normative_type = coalesce(normative_type, 'requirement')
where state_code = 'OR'
  and city_slug is null
  and jurisdiction_level = 'state'
  and coalesce(metadata->>'demo', 'false') = 'true';

update public.compliance_structured_facts
set
  country_code = 'US',
  county_slug = case when city_slug = 'portland' then 'multnomah' else county_slug end,
  county_label = case when city_slug = 'portland' then 'Multnomah' else county_label end,
  court_system = case
    when city_slug = 'portland' then 'Oregon Circuit Court (Multnomah County)'
    when state_code = 'OR' then 'Oregon Circuit Court'
    else court_system
  end,
  normative_type = coalesce(normative_type, 'requirement'),
  publication_status = coalesce(publication_status, 'published_code')
where coalesce(metadata->>'demo', 'false') = 'true';

insert into public.legal_rag_chunks (
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  domain, source_title, source_citation, source_url, chunk_text, metadata,
  court_system, code_set, normative_type, publication_status, effective_on, adopted_on
)
select
  'city',
  'US',
  'OR',
  'multnomah',
  'Multnomah',
  'portland',
  'landlord_tenant',
  'Portland — demo ordinance adopted, not yet in online code',
  'City Council Ord. (demo pending codification)',
  'https://www.portland.gov/council',
  'Demo only: Portland City Council recently adopted an ordinance affecting certain rental notice practices. The measure has an effective date, but the published Portland City Code / Municode mirror may lag. Operators should treat the adopted ordinance text and effective date as controlling until the online code is updated.',
  '{"source_family":"municipal_ordinance","demo":true,"pending_codification":true}'::jsonb,
  'Oregon Circuit Court (Multnomah County)',
  'Portland City Code Title 30 (Rental)',
  'requirement',
  'adopted_not_yet_codified',
  current_date + 14,
  current_date - 7
where not exists (
  select 1
  from public.legal_rag_chunks c
  where c.source_citation = 'City Council Ord. (demo pending codification)'
    and c.city_slug = 'portland'
);
