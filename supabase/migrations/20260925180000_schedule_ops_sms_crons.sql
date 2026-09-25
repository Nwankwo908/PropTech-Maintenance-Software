-- Hourly ops SMS cron: tenant onboarding silence/delivery retries + rent reminders.
-- Invokes Edge Function `run-ops-sms-crons` via pg_net.
--
-- Required once per project (Dashboard → Database → Vault, or SQL):
--   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR_ULO_OPS_CRON_SECRET_OR_SERVICE_ROLE', 'ulo_ops_cron_bearer');
-- Also set Edge secret ULO_OPS_CRON_SECRET to the same bearer value
-- (falls back to CHECK_TENANT_ACTIVATION_SECRET / CHECK_RENT_COLLECTION_SECRET / ADMIN_REASSIGN_SECRET).
--
-- Silence nudges need attempt_number up to 14 (welcome + follow-ups).

do $$
begin
  alter table public.tenant_activation_attempts
    drop constraint if exists tenant_activation_attempts_number_check;
  alter table public.tenant_activation_attempts
    add constraint tenant_activation_attempts_number_check
    check (attempt_number >= 1 and attempt_number <= 14);
exception
  when undefined_table then
    null;
end $$;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.ulo_invoke_edge_function(
  function_name text,
  body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text;
  bearer text;
  request_id bigint;
  target text;
begin
  if function_name is null or btrim(function_name) = '' then
    raise exception 'function_name required';
  end if;

  begin
    select decrypted_secret into base_url
    from vault.decrypted_secrets
    where name = 'project_url'
    limit 1;
  exception
    when undefined_table then
      base_url := null;
    when others then
      base_url := null;
  end;

  if base_url is null or btrim(base_url) = '' then
    base_url := nullif(btrim(current_setting('app.settings.supabase_url', true)), '');
  end if;

  begin
    select decrypted_secret into bearer
    from vault.decrypted_secrets
    where name = 'ulo_ops_cron_bearer'
    limit 1;
  exception
    when undefined_table then
      bearer := null;
    when others then
      bearer := null;
  end;

  if bearer is null or btrim(bearer) = '' then
    begin
      select decrypted_secret into bearer
      from vault.decrypted_secrets
      where name = 'service_role_key'
      limit 1;
    exception
      when undefined_table then
        bearer := null;
      when others then
        bearer := null;
    end;
  end if;

  if bearer is null or btrim(bearer) = '' then
    bearer := nullif(btrim(current_setting('app.settings.ulo_ops_cron_bearer', true)), '');
  end if;

  if base_url is null or btrim(base_url) = '' then
    raise notice 'ulo_invoke_edge_function skipped: set vault secret project_url (or app.settings.supabase_url)';
    return null;
  end if;

  if bearer is null or btrim(bearer) = '' then
    raise notice 'ulo_invoke_edge_function skipped: set vault secret ulo_ops_cron_bearer';
    return null;
  end if;

  target := rtrim(base_url, '/') || '/functions/v1/' || btrim(function_name);

  select net.http_post(
    url := target,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || btrim(bearer)
    ),
    body := coalesce(body, '{}'::jsonb)
  ) into request_id;

  return request_id;
end;
$$;

comment on function public.ulo_invoke_edge_function(text, jsonb) is
  'POST an Edge Function using vault secrets project_url + ulo_ops_cron_bearer (hourly ops SMS cron).';

revoke all on function public.ulo_invoke_edge_function(text, jsonb) from public;
grant execute on function public.ulo_invoke_edge_function(text, jsonb) to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select j.jobid into existing_job_id
  from cron.job j
  where j.jobname = 'ulo-ops-sms-crons'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  -- Hourly at :10 UTC — tenant activation (48h silence + delivery retries)
  -- and rent reminder cadence (5/3/1 days before + due day).
  perform cron.schedule(
    'ulo-ops-sms-crons',
    '10 * * * *',
    $cron$
    select public.ulo_invoke_edge_function('run-ops-sms-crons', '{}'::jsonb);
    $cron$
  );
exception
  when undefined_table then
    raise notice 'pg_cron not available — schedule ulo-ops-sms-crons manually';
  when others then
    raise notice 'Could not schedule ulo-ops-sms-crons: %', SQLERRM;
end $$;
