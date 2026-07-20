-- Ask Ulo: document passport ("digital ID card") on every legal_rag_chunks row.
-- Standard metadata so retrieval can pre-filter by type, publisher, authority,
-- geography, housing program, citation, currency, and version lineage before search.
-- Court opinions and equipment manuals get typed extras on the same card.

-- ---------------------------------------------------------------------------
-- Passport columns
-- ---------------------------------------------------------------------------
alter table public.legal_rag_chunks
  add column if not exists document_type text,
  add column if not exists publisher_name text,
  add column if not exists publisher_kind text,
  add column if not exists authority_tier text,
  add column if not exists last_updated_on date,
  add column if not exists replaces_chunk_id uuid references public.legal_rag_chunks (id),
  add column if not exists source_retrieved_at timestamptz,
  add column if not exists case_number text,
  add column if not exists holding_summary text,
  add column if not exists manufacturer text,
  add column if not exists equipment_model text,
  add column if not exists equipment_type text,
  add column if not exists manual_version text;

alter table public.legal_rag_chunks
  drop constraint if exists legal_rag_chunks_document_type_check;

alter table public.legal_rag_chunks
  add constraint legal_rag_chunks_document_type_check
  check (
    document_type is null
    or document_type in (
      'statute',
      'regulation',
      'court_opinion',
      'municipal_code',
      'building_code',
      'housing_program_rule',
      'agency_guidance',
      'government_guide',
      'maintenance_manual',
      'other'
    )
  );

alter table public.legal_rag_chunks
  drop constraint if exists legal_rag_chunks_publisher_kind_check;

alter table public.legal_rag_chunks
  add constraint legal_rag_chunks_publisher_kind_check
  check (
    publisher_kind is null
    or publisher_kind in (
      'legislature',
      'court',
      'agency',
      'municipality',
      'standards_body',
      'manufacturer',
      'housing_authority',
      'other'
    )
  );

alter table public.legal_rag_chunks
  drop constraint if exists legal_rag_chunks_authority_tier_check;

alter table public.legal_rag_chunks
  add constraint legal_rag_chunks_authority_tier_check
  check (
    authority_tier is null
    or authority_tier in (
      'primary_official',
      'agency_guidance',
      'discovery_mirror',
      'untrusted'
    )
  );

comment on column public.legal_rag_chunks.document_type is
  'Passport: statute | regulation | court_opinion | municipal_code | building_code | housing_program_rule | agency_guidance | government_guide | maintenance_manual | other.';

comment on column public.legal_rag_chunks.publisher_name is
  'Passport: issuing legislature, court, agency, municipality, standards body, or manufacturer.';

comment on column public.legal_rag_chunks.publisher_kind is
  'Passport: category of publisher (legislature, court, agency, …).';

comment on column public.legal_rag_chunks.authority_tier is
  'Passport: legal authority weight — primary_official > agency_guidance > discovery_mirror > untrusted.';

comment on column public.legal_rag_chunks.last_updated_on is
  'Passport: when the source document was last amended or republished.';

comment on column public.legal_rag_chunks.replaces_chunk_id is
  'Passport: prior version this chunk supersedes (version lineage).';

comment on column public.legal_rag_chunks.case_number is
  'Court passport: docket / case number.';

comment on column public.legal_rag_chunks.holding_summary is
  'Court passport: short holding / decision summary.';

comment on column public.legal_rag_chunks.manufacturer is
  'Equipment-manual passport: manufacturer name.';

comment on column public.legal_rag_chunks.equipment_model is
  'Equipment-manual passport: model identifier.';

comment on column public.legal_rag_chunks.equipment_type is
  'Equipment-manual passport: HVAC, water_heater, appliance, etc.';

comment on column public.legal_rag_chunks.manual_version is
  'Equipment-manual passport: manual edition / revision.';

create index if not exists legal_rag_chunks_document_type_idx
  on public.legal_rag_chunks (document_type);

create index if not exists legal_rag_chunks_authority_tier_idx
  on public.legal_rag_chunks (authority_tier);

create index if not exists legal_rag_chunks_housing_program_idx
  on public.legal_rag_chunks (housing_program);

create index if not exists legal_rag_chunks_replaces_idx
  on public.legal_rag_chunks (replaces_chunk_id)
  where replaces_chunk_id is not null;

-- ---------------------------------------------------------------------------
-- Backfill passport from existing domain / metadata / publication fields
-- ---------------------------------------------------------------------------
update public.legal_rag_chunks
set
  document_type = coalesce(
    document_type,
    case
      when coalesce(metadata->>'source_family', '') in ('court_decisions', 'court_opinion')
        then 'court_opinion'
      when coalesce(metadata->>'source_family', '') in ('municipal_code')
        then 'municipal_code'
      when coalesce(metadata->>'source_family', '') in ('housing_authority')
        or housing_program is not null
        then 'housing_program_rule'
      when coalesce(metadata->>'source_family', '') in ('building_codes', 'icc_ipmc')
        or domain = 'building_code'
        then 'building_code'
      when coalesce(metadata->>'source_family', '') in ('gov_faqs_guides', 'agency_guidance')
        or publication_status = 'agency_guidance'
        then 'agency_guidance'
      when coalesce(metadata->>'source_family', '') in ('maintenance_docs')
        then 'maintenance_manual'
      when coalesce(metadata->>'source_family', '') in ('federal_hud_fha')
        and domain = 'fair_housing'
        then 'statute'
      when coalesce(metadata->>'source_family', '') in ('federal_hud_fha')
        then 'regulation'
      when coalesce(metadata->>'source_family', '') in ('state_statute', 'laws_regulations')
        or domain = 'landlord_tenant'
        then 'statute'
      when domain = 'finance'
        then 'government_guide'
      else 'other'
    end
  ),
  publisher_kind = coalesce(
    publisher_kind,
    case
      when coalesce(metadata->>'source_family', '') in ('court_decisions', 'court_opinion')
        then 'court'
      when jurisdiction_level = 'federal'
        and coalesce(metadata->>'source_family', '') in ('federal_hud_fha', 'agency_guidance', 'gov_faqs_guides')
        then 'agency'
      when jurisdiction_level = 'federal'
        then 'legislature'
      when coalesce(metadata->>'source_family', '') in ('housing_authority')
        then 'housing_authority'
      when coalesce(metadata->>'source_family', '') in ('municipal_code')
        or jurisdiction_level in ('city', 'county')
        then 'municipality'
      when coalesce(metadata->>'source_family', '') in ('building_codes', 'icc_ipmc')
        then 'standards_body'
      when coalesce(metadata->>'source_family', '') in ('maintenance_docs')
        then 'manufacturer'
      when jurisdiction_level = 'state'
        then 'legislature'
      else 'other'
    end
  ),
  publisher_name = coalesce(
    publisher_name,
    nullif(trim(metadata->>'publisher'), ''),
    case
      when jurisdiction_level = 'federal'
        and domain = 'fair_housing'
        then 'U.S. Congress / HUD'
      when jurisdiction_level = 'federal'
        then 'U.S. Department of Housing and Urban Development'
      when state_code = 'OR' and jurisdiction_level = 'state'
        then 'Oregon Legislative Assembly'
      when city_slug = 'portland' and jurisdiction_level = 'city'
        then 'City of Portland'
      when coalesce(metadata->>'source_family', '') = 'housing_authority'
        then coalesce(nullif(trim(source_title), ''), 'Housing authority')
      else nullif(trim(source_title), '')
    end
  ),
  authority_tier = coalesce(
    authority_tier,
    case
      when publication_status = 'agency_guidance'
        or coalesce(metadata->>'source_family', '') in (
          'housing_authority',
          'gov_faqs_guides',
          'agency_guidance',
          'financial_data'
        )
        then 'agency_guidance'
      when coalesce(metadata->>'source_family', '') in ('discovery_mirror')
        then 'discovery_mirror'
      else 'primary_official'
    end
  ),
  last_updated_on = coalesce(last_updated_on, effective_on, adopted_on),
  case_number = coalesce(case_number, nullif(trim(metadata->>'case_number'), '')),
  holding_summary = coalesce(
    holding_summary,
    nullif(trim(metadata->>'holding_summary'), '')
  );

-- Demo court opinion extras (Oregon seed)
update public.legal_rag_chunks
set
  court_system = coalesce(court_system, 'oregon_courts'),
  case_number = coalesce(case_number, 'S123456'),
  holding_summary = coalesce(
    holding_summary,
    'Illustrative holding: residential landlord-tenant notice and deposit rules turn on current ORS chapter 90 text.'
  )
where coalesce(metadata->>'source_family', '') in ('court_decisions', 'court_opinion')
  and coalesce(metadata->>'demo', 'false') = 'true';

-- ---------------------------------------------------------------------------
-- Shared passport pre-filter logic (inline in both match RPCs)
-- ---------------------------------------------------------------------------
-- Housing: no program on the question → exclude program-only docs;
--          program set → include general (null) + matching program.
-- Document types: optional allow-list.
-- Answerable-only: primary_official + agency_guidance (null treated as answerable).

drop function if exists public.match_legal_rag_chunks(
  extensions.vector,
  int,
  text,
  text,
  text,
  text,
  text
);

drop function if exists public.match_legal_rag_chunks_fts(
  text,
  int,
  text,
  text,
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
  filter_country_code text default 'US',
  filter_housing_program text default null,
  filter_document_types text[] default null,
  filter_answerable_only boolean default true
)
returns table (
  id uuid,
  jurisdiction_level text,
  country_code text,
  state_code text,
  county_slug text,
  city_slug text,
  domain text,
  document_type text,
  publisher_name text,
  publisher_kind text,
  authority_tier text,
  housing_program text,
  source_title text,
  source_citation text,
  source_url text,
  chunk_text text,
  metadata jsonb,
  publication_status text,
  normative_type text,
  effective_on date,
  last_updated_on date,
  case_number text,
  holding_summary text,
  manufacturer text,
  equipment_model text,
  equipment_type text,
  manual_version text,
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
    c.document_type,
    c.publisher_name,
    c.publisher_kind,
    c.authority_tier,
    c.housing_program,
    c.source_title,
    c.source_citation,
    c.source_url,
    c.chunk_text,
    c.metadata,
    c.publication_status,
    c.normative_type,
    c.effective_on,
    c.last_updated_on,
    c.case_number,
    c.holding_summary,
    c.manufacturer,
    c.equipment_model,
    c.equipment_type,
    c.manual_version,
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
    and (
      case
        when filter_housing_program is null then c.housing_program is null
        else (
          c.housing_program is null
          or lower(c.housing_program) = lower(filter_housing_program)
        )
      end
    )
    and (
      filter_document_types is null
      or cardinality(filter_document_types) = 0
      or c.document_type = any (filter_document_types)
    )
    and (
      filter_answerable_only is distinct from true
      or c.authority_tier is null
      or c.authority_tier in ('primary_official', 'agency_guidance')
    )
    and (c.repealed_on is null or c.repealed_on > current_date)
  order by
    case c.publication_status
      when 'adopted_not_yet_codified' then 0
      when 'published_code' then 1
      else 2
    end,
    case c.authority_tier
      when 'primary_official' then 0
      when 'agency_guidance' then 1
      else 2
    end,
    c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 6), 20));
$$;

comment on function public.match_legal_rag_chunks is
  'Ask Ulo legal RAG vector match with document-passport pre-filters (geo, housing program, document type, authority).';

create or replace function public.match_legal_rag_chunks_fts(
  query_text text,
  match_count int default 8,
  filter_state_code text default null,
  filter_city_slug text default null,
  domain_filter text default null,
  filter_county_slug text default null,
  filter_country_code text default 'US',
  filter_housing_program text default null,
  filter_document_types text[] default null,
  filter_answerable_only boolean default true
)
returns table (
  id uuid,
  jurisdiction_level text,
  country_code text,
  state_code text,
  county_slug text,
  city_slug text,
  domain text,
  document_type text,
  publisher_name text,
  publisher_kind text,
  authority_tier text,
  housing_program text,
  source_title text,
  source_citation text,
  source_url text,
  chunk_text text,
  metadata jsonb,
  publication_status text,
  normative_type text,
  effective_on date,
  last_updated_on date,
  case_number text,
  holding_summary text,
  manufacturer text,
  equipment_model text,
  equipment_type text,
  manual_version text,
  rank float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select websearch_to_tsquery(
      'english',
      left(trim(coalesce(query_text, '')), 500)
    ) as tsq
    where length(trim(coalesce(query_text, ''))) > 0
  )
  select
    c.id,
    c.jurisdiction_level,
    c.country_code,
    c.state_code,
    c.county_slug,
    c.city_slug,
    c.domain,
    c.document_type,
    c.publisher_name,
    c.publisher_kind,
    c.authority_tier,
    c.housing_program,
    c.source_title,
    c.source_citation,
    c.source_url,
    c.chunk_text,
    c.metadata,
    c.publication_status,
    c.normative_type,
    c.effective_on,
    c.last_updated_on,
    c.case_number,
    c.holding_summary,
    c.manufacturer,
    c.equipment_model,
    c.equipment_type,
    c.manual_version,
    ts_rank_cd(c.search_vector, q.tsq)::float as rank
  from public.legal_rag_chunks c
  inner join q on true
  where q.tsq is not null
    and c.search_vector @@ q.tsq
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
    and (
      case
        when filter_housing_program is null then c.housing_program is null
        else (
          c.housing_program is null
          or lower(c.housing_program) = lower(filter_housing_program)
        )
      end
    )
    and (
      filter_document_types is null
      or cardinality(filter_document_types) = 0
      or c.document_type = any (filter_document_types)
    )
    and (
      filter_answerable_only is distinct from true
      or c.authority_tier is null
      or c.authority_tier in ('primary_official', 'agency_guidance')
    )
    and (c.repealed_on is null or c.repealed_on > current_date)
  order by
    case c.publication_status
      when 'adopted_not_yet_codified' then 0
      when 'published_code' then 1
      else 2
    end,
    case c.authority_tier
      when 'primary_official' then 0
      when 'agency_guidance' then 1
      else 2
    end,
    ts_rank_cd(c.search_vector, q.tsq) desc
  limit greatest(1, least(coalesce(match_count, 8), 24));
$$;

comment on function public.match_legal_rag_chunks_fts is
  'Ask Ulo legal FTS match with document-passport pre-filters (geo, housing program, document type, authority).';

grant execute on function public.match_legal_rag_chunks(
  extensions.vector,
  int,
  text,
  text,
  text,
  text,
  text,
  text,
  text[],
  boolean
) to service_role, authenticated;

grant execute on function public.match_legal_rag_chunks_fts(
  text,
  int,
  text,
  text,
  text,
  text,
  text,
  text,
  text[],
  boolean
) to service_role, authenticated;
