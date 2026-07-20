-- Ask Ulo RAG: legal vector store, structured compliance facts, audit turns.
-- Legal chunks stay separate from ops graph / maintenance history.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- legal_rag_chunks — statutes / codes / HUD-FHA excerpts (vector store only)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_rag_chunks (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_level text not null
    check (jurisdiction_level in ('federal', 'state', 'city')),
  state_code text,
  city_slug text,
  domain text not null
    check (
      domain in (
        'landlord_tenant',
        'building_code',
        'fair_housing',
        'finance',
        'socioeconomic'
      )
    ),
  source_title text not null,
  source_citation text,
  source_url text,
  chunk_text text not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_rag_chunks_state_when_needed check (
    jurisdiction_level = 'federal'
    or (state_code is not null and length(trim(state_code)) = 2)
  )
);

comment on table public.legal_rag_chunks is
  'Chunked legal/compliance text for Ask Ulo RAG. Do not mix ops graph or maintenance rows here.';

create index if not exists legal_rag_chunks_jurisdiction_idx
  on public.legal_rag_chunks (jurisdiction_level, state_code, city_slug);

create index if not exists legal_rag_chunks_domain_idx
  on public.legal_rag_chunks (domain);

create index if not exists legal_rag_chunks_embedding_hnsw_idx
  on public.legal_rag_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

-- ---------------------------------------------------------------------------
-- match_legal_rag_chunks — filter jurisdiction, then cosine distance
-- ---------------------------------------------------------------------------
create or replace function public.match_legal_rag_chunks(
  query_embedding extensions.vector(1536),
  match_count int default 6,
  filter_state_code text default null,
  filter_city_slug text default null,
  domain_filter text default null
)
returns table (
  id uuid,
  jurisdiction_level text,
  state_code text,
  city_slug text,
  domain text,
  source_title text,
  source_citation text,
  source_url text,
  chunk_text text,
  metadata jsonb,
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
    c.state_code,
    c.city_slug,
    c.domain,
    c.source_title,
    c.source_citation,
    c.source_url,
    c.chunk_text,
    c.metadata,
    (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.legal_rag_chunks c
  where c.embedding is not null
    and (
      c.jurisdiction_level = 'federal'
      or (
        filter_state_code is not null
        and upper(c.state_code) = upper(filter_state_code)
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
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 6), 20));
$$;

comment on function public.match_legal_rag_chunks is
  'Ask Ulo legal RAG: jurisdiction filter then cosine similarity on embeddings.';

grant execute on function public.match_legal_rag_chunks(
  extensions.vector,
  int,
  text,
  text,
  text
) to service_role;

grant execute on function public.match_legal_rag_chunks(
  extensions.vector,
  int,
  text,
  text,
  text
) to authenticated;

-- ---------------------------------------------------------------------------
-- compliance_structured_facts — numeric / deterministic (not embedded)
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_structured_facts (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_level text not null
    check (jurisdiction_level in ('federal', 'state', 'city')),
  state_code text,
  city_slug text,
  fact_key text not null,
  value_numeric numeric,
  value_text text,
  unit text,
  source_citation text,
  source_url text,
  effective_on date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_structured_facts_has_value check (
    value_numeric is not null or (value_text is not null and length(trim(value_text)) > 0)
  )
);

comment on table public.compliance_structured_facts is
  'Deterministic compliance numbers for Ask Ulo (deposits, notice days, late-fee caps). Never invent via LLM.';

create unique index if not exists compliance_structured_facts_scope_key_uidx
  on public.compliance_structured_facts (
    coalesce(upper(state_code), ''),
    coalesce(lower(city_slug), ''),
    fact_key
  );

create index if not exists compliance_structured_facts_key_idx
  on public.compliance_structured_facts (fact_key);

-- ---------------------------------------------------------------------------
-- ask_ulo_turns — optional audit of Q&A
-- ---------------------------------------------------------------------------
create table if not exists public.ask_ulo_turns (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  question text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  tools_used jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

comment on table public.ask_ulo_turns is
  'Ask Ulo turn audit. Written by service role from ask-ulo edge function.';

create index if not exists ask_ulo_turns_landlord_created_idx
  on public.ask_ulo_turns (landlord_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: staff admin read; writes via service role only
-- ---------------------------------------------------------------------------
alter table public.legal_rag_chunks enable row level security;
alter table public.compliance_structured_facts enable row level security;
alter table public.ask_ulo_turns enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'legal_rag_chunks'
      and policyname = 'legal_rag_chunks_staff_select'
  ) then
    create policy legal_rag_chunks_staff_select
      on public.legal_rag_chunks
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'compliance_structured_facts'
      and policyname = 'compliance_structured_facts_staff_select'
  ) then
    create policy compliance_structured_facts_staff_select
      on public.compliance_structured_facts
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ask_ulo_turns'
      and policyname = 'ask_ulo_turns_staff_select'
  ) then
    create policy ask_ulo_turns_staff_select
      on public.ask_ulo_turns
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;
end $$;

grant select on public.legal_rag_chunks to authenticated, service_role;
grant select on public.compliance_structured_facts to authenticated, service_role;
grant select on public.ask_ulo_turns to authenticated, service_role;
grant all on public.legal_rag_chunks to service_role;
grant all on public.compliance_structured_facts to service_role;
grant all on public.ask_ulo_turns to service_role;

-- ---------------------------------------------------------------------------
-- Seeds: Oregon / Portland (demo footprint). Embeddings null until backfilled;
-- ask-ulo legal tool falls back to keyword match so demo works offline of
-- external embedding APIs for chunk content.
-- ---------------------------------------------------------------------------
insert into public.legal_rag_chunks (
  jurisdiction_level, state_code, city_slug, domain,
  source_title, source_citation, source_url, chunk_text, metadata
)
values
(
  'state', 'OR', null, 'landlord_tenant',
  'Oregon Residential Landlord and Tenant Act — security deposits',
  'ORS 90.300',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  'Under Oregon ORS 90.300, a landlord may generally require a security deposit. The landlord must provide a written accounting of deductions and return any refundable balance within the statutory timeline after termination of tenancy. Deposit handling rules apply to residential tenancies covered by ORS chapter 90.',
  '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'landlord_tenant',
  'Oregon Residential Landlord and Tenant Act — month-to-month notice',
  'ORS 90.427',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  'ORS 90.427 sets notice requirements to terminate a month-to-month tenancy in Oregon. Required notice length depends on how long the tenant has occupied the dwelling and other statutory conditions. Landlords should confirm current notice periods before serving termination notices.',
  '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'landlord_tenant',
  'Oregon — late rent charges',
  'ORS 90.260',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  'Oregon ORS 90.260 limits late charges for unpaid rent. Late fees must be reasonable and comply with statutory caps and notice requirements. Charging fees above the allowed amount can be challenged by the tenant.',
  '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'landlord_tenant',
  'Oregon — habitability and repairs',
  'ORS 90.320',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  'ORS 90.320 requires landlords to maintain rental dwellings in a habitable condition, including plumbing, heat, weatherproofing, and other essential services. Residents may have remedies when habitability obligations are not met after proper notice.',
  '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'city', 'OR', 'portland', 'landlord_tenant',
  'Portland Rental Services — security deposit practices',
  'Portland City Code Title 30 (Rental)',
  'https://www.portland.gov/code/30',
  'Portland rental regulations supplement Oregon landlord-tenant law. Property managers operating in Portland should follow city rental registration, screening, and deposit-related requirements in addition to ORS chapter 90. Confirm current Portland Housing Bureau guidance before changing deposit policies.',
  '{"source_family":"municipal_code","demo":true}'::jsonb
),
(
  'city', 'OR', 'portland', 'landlord_tenant',
  'Portland — relocation / no-cause notice context',
  'Portland City Code / FAIR Ordinance context',
  'https://www.portland.gov/phb',
  'Portland has adopted additional tenant protections beyond statewide defaults, including relocation assistance and notice rules for certain no-cause terminations. Always verify whether a unit is covered and which notice + payment obligations apply before ending a tenancy.',
  '{"source_family":"municipal_code","demo":true}'::jsonb
),
(
  'federal', null, null, 'fair_housing',
  'Fair Housing Act — protected classes overview',
  '42 U.S.C. § 3601 et seq.',
  'https://www.hud.gov/program_offices/fair_housing_equal_opp',
  'The federal Fair Housing Act prohibits discrimination in housing based on race, color, national origin, religion, sex, familial status, and disability. Landlords and property managers must apply screening, advertising, and accommodation policies consistently and provide reasonable accommodations for disabilities when required.',
  '{"source_family":"federal_hud_fha","demo":true}'::jsonb
),
(
  'federal', null, null, 'fair_housing',
  'HUD — reasonable accommodations guidance (excerpt)',
  'HUD FHEO guidance',
  'https://www.hud.gov/program_offices/fair_housing_equal_opp/reasonable_accommodations_and_modifications',
  'HUD guidance explains that housing providers may need to make reasonable accommodations in rules, policies, practices, or services when necessary for a person with a disability to use and enjoy a dwelling. Requests should be evaluated in good faith; medical verification may be requested when the disability or need is not obvious.',
  '{"source_family":"federal_hud_fha","demo":true}'::jsonb
),
(
  'federal', null, null, 'building_code',
  'IPMC baseline — maintenance of structures (demo excerpt)',
  'ICC International Property Maintenance Code (reference)',
  'https://www.iccsafe.org/',
  'The International Property Maintenance Code (IPMC) provides a baseline for property maintenance: structures must be kept weatherproof, sanitary, and free from unsafe conditions. Local jurisdictions may adopt amended versions; Portland and Oregon localities may enforce local housing/property maintenance codes that track or exceed IPMC concepts.',
  '{"source_family":"icc_ipmc","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'finance',
  'Oregon — property tax context for operators',
  'ORS chapter 308 (context)',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors308.html',
  'Oregon property taxes are assessed at the county level under state frameworks. Multifamily operators should track assessed value changes, exemption programs, and payment calendars with their county assessor. This is orientation text for Ask Ulo demos, not tax advice.',
  '{"source_family":"state_finance","demo":true}'::jsonb
),
(
  'city', 'OR', 'portland', 'socioeconomic',
  'Portland metro — housing market orientation',
  'Demo market note',
  null,
  'Portland metro rental demand and vacancy vary by submarket (inner eastside, Beaverton, Hillsboro, Gresham). Ask Ulo uses portfolio ops data for live occupancy; this chunk only provides geographic orientation for compliance questions tied to Portland-area properties.',
  '{"source_family":"market_orientation","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'landlord_tenant',
  'Oregon — entry notice',
  'ORS 90.322',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  'ORS 90.322 generally requires landlords to give at least 24 hours notice before entering a dwelling unit, with exceptions for emergencies and other statutory situations. Notice should state the date, time, and purpose of entry.',
  '{"source_family":"state_statute","demo":true}'::jsonb
);

insert into public.compliance_structured_facts (
  jurisdiction_level, state_code, city_slug, fact_key,
  value_numeric, value_text, unit, source_citation, source_url, effective_on, metadata
)
values
(
  'state', 'OR', null, 'security_deposit_max_months',
  0, 'No fixed statewide numeric cap in ORS 90.300; amount must be reasonable and properly accounted for.',
  null, 'ORS 90.300', 'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  '2024-01-01', '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'notice_period_days_month_to_month',
  30, 'Baseline 30-day notice is commonly required; longer occupation can require longer notice under ORS 90.427 — verify current statute.',
  'days', 'ORS 90.427', 'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  '2024-01-01', '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'late_fee_cap_pct',
  5, 'Oregon late rent charges are constrained by ORS 90.260 (often discussed as a percentage of periodic rent with additional rules). Confirm the exact statutory formula before assessing fees.',
  'percent', 'ORS 90.260', 'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  '2024-01-01', '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'city', 'OR', 'portland', 'relocation_assistance_note',
  null, 'Portland may require relocation assistance for certain no-cause terminations. Confirm coverage and amounts with current Portland Housing Bureau rules before ending a tenancy.',
  null, 'Portland rental protections', 'https://www.portland.gov/phb',
  '2024-01-01', '{"source_family":"municipal_code","demo":true}'::jsonb
),
(
  'state', 'OR', null, 'landlord_entry_notice_hours',
  24, 'Generally at least 24 hours notice before non-emergency entry (ORS 90.322).',
  'hours', 'ORS 90.322', 'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  '2024-01-01', '{"source_family":"state_statute","demo":true}'::jsonb
),
(
  'federal', null, null, 'fha_protected_classes_count',
  7, 'Fair Housing Act core protected classes: race, color, national origin, religion, sex, familial status, disability.',
  'classes', '42 U.S.C. § 3601 et seq.', 'https://www.hud.gov/program_offices/fair_housing_equal_opp',
  '1968-04-11', '{"source_family":"federal_hud_fha","demo":true}'::jsonb
);
