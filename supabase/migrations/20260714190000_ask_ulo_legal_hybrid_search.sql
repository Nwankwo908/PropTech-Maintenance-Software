-- Ask Ulo legal hybrid search: Postgres FTS alongside pgvector.
-- Keyword (exact terms / citations) + semantic (meaning) can be fused in the edge.

-- ---------------------------------------------------------------------------
-- search_vector — weighted title/citation + chunk body
-- ---------------------------------------------------------------------------
alter table public.legal_rag_chunks
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(source_title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(source_citation, '')), 'A')
    || setweight(to_tsvector('english', coalesce(chunk_text, '')), 'B')
  ) stored;

create index if not exists legal_rag_chunks_search_vector_idx
  on public.legal_rag_chunks
  using gin (search_vector);

comment on column public.legal_rag_chunks.search_vector is
  'English FTS for Ask Ulo keyword retrieval (titles/citations weighted higher than body).';

-- ---------------------------------------------------------------------------
-- match_legal_rag_chunks_fts — jurisdiction-filtered full-text rank
-- ---------------------------------------------------------------------------
create or replace function public.match_legal_rag_chunks_fts(
  query_text text,
  match_count int default 8,
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
    c.source_title,
    c.source_citation,
    c.source_url,
    c.chunk_text,
    c.metadata,
    c.publication_status,
    c.normative_type,
    c.effective_on,
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
    and (c.repealed_on is null or c.repealed_on > current_date)
  order by
    case c.publication_status
      when 'adopted_not_yet_codified' then 0
      when 'published_code' then 1
      else 2
    end,
    ts_rank_cd(c.search_vector, q.tsq) desc
  limit greatest(1, least(coalesce(match_count, 8), 24));
$$;

comment on function public.match_legal_rag_chunks_fts is
  'Ask Ulo legal keyword/FTS retrieval: websearch_to_tsquery over search_vector with jurisdiction filters.';

grant execute on function public.match_legal_rag_chunks_fts(
  text,
  int,
  text,
  text,
  text,
  text,
  text
) to service_role;

grant execute on function public.match_legal_rag_chunks_fts(
  text,
  int,
  text,
  text,
  text,
  text,
  text
) to authenticated;
