-- Landing Try Demo: one sample SMS per phone + experience option (audit + rate limit).

create table if not exists public.try_demo_experience_sends (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  email text not null,
  experience text not null
    check (experience in ('landlord', 'resident', 'vendor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_e164, experience)
);

create index if not exists try_demo_experience_sends_email_idx
  on public.try_demo_experience_sends (email);

alter table public.try_demo_experience_sends enable row level security;

-- Service role only (edge function). No public/anon policies.
