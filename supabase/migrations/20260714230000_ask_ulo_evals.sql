-- Ask Ulo continuous evaluation: per-answer quality, latency, cost, faithfulness, human feedback.
-- Complements ask_ulo_turns + operations_graph ask_ulo.answered events with queryable metrics.

create table if not exists public.ask_ulo_evals (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.landlords (id) on delete cascade,
  conversation_id uuid,
  turn_id uuid references public.ask_ulo_turns (id) on delete set null,
  question_excerpt text,
  intent text not null,
  mode text,
  model text,
  -- Outcome
  gate_status text, -- ok | clarify | refuse | null
  refused boolean not null default false,
  clarified boolean not null default false,
  require_counsel boolean not null default false,
  known_unknown boolean not null default false, -- correctly declined / asked for human
  -- Quality gate snapshot
  location_status text, -- pass | fail | warn | skip
  topic_status text,
  scope_status text,
  sources_status text,
  grounding_status text,
  safety_qc_status text,
  quality_summary text,
  quality_checks jsonb not null default '[]'::jsonb,
  -- Jurisdiction / sensitivity
  state_code text,
  county_slug text,
  city_slug text,
  housing_program text,
  sensitive_topic_ids text[] not null default '{}',
  fair_housing_flags text[] not null default '{}',
  human_decision_flags text[] not null default '{}',
  -- Retrieval
  citation_count integer not null default 0,
  primary_official_count integer not null default 0,
  agency_guidance_count integer not null default 0,
  discovery_mirror_count integer not null default 0,
  retrieval_cache_hit boolean not null default false,
  answer_confidence text,
  -- Faithfulness (rule-based claim vs retrieved sources)
  faithfulness_score numeric(4,3), -- 0..1; null when N/A
  faithfulness_detail jsonb not null default '{}'::jsonb,
  -- Performance
  latency_ms integer,
  embed_ms integer,
  retrieve_ms integer,
  synthesize_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  embed_tokens integer,
  estimated_cost_usd numeric(10,6),
  -- Human feedback / override
  human_rating text, -- up | down
  human_override_reason text, -- wrong_location | bad_citation | unsupported_claim | …
  human_override_note text,
  human_rated_at timestamptz,
  counsel_handoff_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.ask_ulo_evals is
  'Ask Ulo continuous eval: location/sources/grounding, faithfulness, latency, cost, human override.';

create index if not exists ask_ulo_evals_landlord_created_idx
  on public.ask_ulo_evals (landlord_id, created_at desc);

create index if not exists ask_ulo_evals_intent_created_idx
  on public.ask_ulo_evals (intent, created_at desc);

create index if not exists ask_ulo_evals_grounding_idx
  on public.ask_ulo_evals (grounding_status, created_at desc)
  where grounding_status is not null;

create index if not exists ask_ulo_evals_human_rating_idx
  on public.ask_ulo_evals (human_rating, created_at desc)
  where human_rating is not null;

alter table public.ask_ulo_evals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ask_ulo_evals'
      and policyname = 'ask_ulo_evals_staff_select'
  ) then
    create policy ask_ulo_evals_staff_select
      on public.ask_ulo_evals
      for select
      to authenticated
      using (public.is_staff_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ask_ulo_evals'
      and policyname = 'ask_ulo_evals_service_all'
  ) then
    create policy ask_ulo_evals_service_all
      on public.ask_ulo_evals
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

grant select on public.ask_ulo_evals to authenticated, service_role;
grant all on public.ask_ulo_evals to service_role;

-- Daily rollup for dashboards (staff / service).
create or replace view public.ask_ulo_eval_daily as
select
  date_trunc('day', created_at)::date as day,
  intent,
  count(*)::integer as answers,
  count(*) filter (where refused)::integer as refused_count,
  count(*) filter (where clarified)::integer as clarified_count,
  count(*) filter (where require_counsel)::integer as counsel_required_count,
  count(*) filter (where known_unknown)::integer as known_unknown_count,
  count(*) filter (where location_status = 'fail')::integer as location_fail_count,
  count(*) filter (where grounding_status = 'fail')::integer as grounding_fail_count,
  count(*) filter (where retrieval_cache_hit)::integer as cache_hits,
  count(*) filter (where human_rating = 'down')::integer as thumbs_down,
  count(*) filter (where human_rating = 'up')::integer as thumbs_up,
  count(*) filter (where counsel_handoff_at is not null)::integer as counsel_handoffs,
  round(avg(faithfulness_score)::numeric, 3) as avg_faithfulness,
  round(avg(latency_ms)::numeric, 0) as avg_latency_ms,
  round(sum(estimated_cost_usd)::numeric, 4) as total_estimated_cost_usd
from public.ask_ulo_evals
group by 1, 2;

comment on view public.ask_ulo_eval_daily is
  'Ask Ulo eval daily aggregates by intent (accuracy, handoff, latency, cost).';

grant select on public.ask_ulo_eval_daily to authenticated, service_role;
