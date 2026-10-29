-- Ask Ulo performance by agent mode, from real questions in the last 30 days.
-- Run in the Supabase SQL editor (read-only). Change the interval to widen the window.
-- Agent mode comes from the ask_ulo.* activity event saved with each answer.
select
  coalesce(g.metadata->>'agent_mode', '(no mode chip)') as agent_mode,
  count(*) as answers,
  round((percentile_cont(0.5) within group (order by e.latency_ms) / 1000.0)::numeric, 1) as p50_seconds,
  round((percentile_cont(0.9) within group (order by e.latency_ms) / 1000.0)::numeric, 1) as p90_seconds,
  round(max(e.latency_ms) / 1000.0, 1) as slowest_seconds,
  round(avg(e.retrieve_ms)) as avg_retrieve_ms,
  round(avg(e.synthesize_ms)) as avg_write_answer_ms,
  round(avg(e.prompt_tokens)) as avg_prompt_tokens,
  round(avg(e.completion_tokens)) as avg_answer_tokens,
  round(sum(e.estimated_cost_usd), 4) as total_cost_usd,
  round(100.0 * avg(case when e.mode = 'fallback' then 1 else 0 end), 1) as pct_no_ai_fallback,
  round(100.0 * avg(case when e.refused or e.clarified then 1 else 0 end), 1) as pct_refused_or_clarified,
  round(100.0 * avg(case when e.grounding_status = 'fail' then 1 else 0 end), 1) as pct_grounding_fail,
  round(100.0 * avg(case when e.retrieval_cache_hit then 1 else 0 end), 1) as pct_cache_hit,
  count(*) filter (where e.human_rating = 'up') as thumbs_up,
  count(*) filter (where e.human_rating = 'down') as thumbs_down
from public.ask_ulo_evals e
left join public.operations_graph_events g
  on g.event_type like 'ask_ulo.%'
  and g.metadata->>'eval_id' = e.id::text
where e.created_at > now() - interval '30 days'
group by 1
order by answers desc;
