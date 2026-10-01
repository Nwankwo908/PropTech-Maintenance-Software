-- Messages KPI: per-inbound reply rate (DB aggregate — not a capped client read).
-- An inbound is answered when a same-thread outbound follows it before the next
-- inbound (if any) and within p_window_hours. Outbound-only threads are excluded.

create or replace function public.communication_inbound_response_rate(
  p_landlord_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_window_hours integer default 24
)
returns table (
  total_inbounds integer,
  answered_inbounds integer,
  response_rate_pct integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      p_landlord_id as landlord_id,
      p_from as window_from,
      p_to as window_to,
      greatest(coalesce(p_window_hours, 24), 1) as window_hours
  ),
  all_inbounds as (
    select
      m.id,
      m.conversation_id,
      m.created_at,
      lead(m.created_at) over (
        partition by m.conversation_id
        order by m.created_at asc, m.id asc
      ) as next_inbound_at
    from public.sms_messages m
    cross join params p
    where m.landlord_id = p.landlord_id
      and lower(m.direction) = 'inbound'
  ),
  window_inbounds as (
    select i.*
    from all_inbounds i
    cross join params p
    where i.created_at >= p.window_from
      and i.created_at < p.window_to
  ),
  scored as (
    select
      w.id,
      exists (
        select 1
        from public.sms_messages o
        cross join params p
        where o.landlord_id = p.landlord_id
          and o.conversation_id = w.conversation_id
          and lower(o.direction) = 'outbound'
          and o.created_at > w.created_at
          and o.created_at <= w.created_at + make_interval(hours => p.window_hours)
          and (
            w.next_inbound_at is null
            or o.created_at < w.next_inbound_at
          )
      ) as answered
    from window_inbounds w
  )
  select
    count(*)::integer as total_inbounds,
    count(*) filter (where answered)::integer as answered_inbounds,
    case
      when count(*) = 0 then null
      else round(
        100.0 * count(*) filter (where answered) / count(*)
      )::integer
    end as response_rate_pct
  from scored;
$$;

comment on function public.communication_inbound_response_rate(uuid, timestamptz, timestamptz, integer) is
  'Messages Response rate: answered inbound SMS ÷ inbound SMS in [from,to), answered = same-thread outbound after inbound, before next inbound, within window hours. Excludes outbound-only threads.';

revoke all on function public.communication_inbound_response_rate(uuid, timestamptz, timestamptz, integer) from public;
grant execute on function public.communication_inbound_response_rate(uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.communication_inbound_response_rate(uuid, timestamptz, timestamptz, integer) to service_role;
