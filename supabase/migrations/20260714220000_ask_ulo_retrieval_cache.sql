-- Ask Ulo: retrieval cache — reuse scoped legal/structured packets when sources unchanged.
-- Keyed by intent + jurisdiction + normalized question + source freshness token.
-- Does NOT store full LLM answers (property/safety context varies); saves embedding + RAG work.

create table if not exists public.ask_ulo_retrieval_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  intent text not null,
  state_code text,
  city_slug text,
  county_slug text,
  housing_program text,
  question_norm text not null,
  source_freshness_token text not null,
  -- { legal: LegalRagSearchResult-ish, structured: StructuredLookupResult-ish }
  payload jsonb not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

comment on table public.ask_ulo_retrieval_cache is
  'Ask Ulo scoped retrieval reuse: same jurisdiction+topic+fresh sources skips re-embedding/RAG.';

create index if not exists ask_ulo_retrieval_cache_lookup_idx
  on public.ask_ulo_retrieval_cache (state_code, city_slug, intent, expires_at);

create index if not exists ask_ulo_retrieval_cache_expires_idx
  on public.ask_ulo_retrieval_cache (expires_at);

alter table public.ask_ulo_retrieval_cache enable row level security;

-- Edge/service only — no authenticated client reads
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ask_ulo_retrieval_cache'
      and policyname = 'ask_ulo_retrieval_cache_service_all'
  ) then
    create policy ask_ulo_retrieval_cache_service_all
      on public.ask_ulo_retrieval_cache
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

grant all on public.ask_ulo_retrieval_cache to service_role;

-- Optional: purge expired rows (callable from cron / refresh job)
create or replace function public.purge_ask_ulo_retrieval_cache_expired()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.ask_ulo_retrieval_cache
  where expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.purge_ask_ulo_retrieval_cache_expired is
  'Delete expired Ask Ulo retrieval cache rows.';

grant execute on function public.purge_ask_ulo_retrieval_cache_expired() to service_role;
