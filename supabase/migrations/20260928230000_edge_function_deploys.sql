-- Track Edge Function deploys (name, git SHA, import-graph hash).
-- Written by scripts/deploy-edge-function.sh; read by npm run deploy:status.
-- Not a committed status file — keeps the working tree clean.

create table if not exists public.edge_function_deploys (
  id bigserial primary key,
  function_name text not null,
  git_sha text not null,
  import_graph_hash text not null,
  deployed_at timestamptz not null default now()
);

create index if not exists edge_function_deploys_name_deployed_at_idx
  on public.edge_function_deploys (function_name, deployed_at desc);

comment on table public.edge_function_deploys is
  'One row per Edge Function deploy: function slug, git HEAD SHA, and import-graph content hash.';
