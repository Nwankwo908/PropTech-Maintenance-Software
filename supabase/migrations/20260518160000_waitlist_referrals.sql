alter table public.waitlist_signups
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.waitlist_signups(id) on delete set null;

update public.waitlist_signups
set referral_code = left(replace(id::text, '-', ''), 10)
where referral_code is null;

create or replace function public.waitlist_signups_set_referral_code()
returns trigger
language plpgsql
as $$
begin
  if new.referral_code is null or new.referral_code = '' then
    new.referral_code := left(replace(new.id::text, '-', ''), 10);
  end if;
  return new;
end;
$$;

drop trigger if exists waitlist_signups_referral_code_trg on public.waitlist_signups;
create trigger waitlist_signups_referral_code_trg
before insert on public.waitlist_signups
for each row
execute function public.waitlist_signups_set_referral_code();

alter table public.waitlist_signups
  alter column referral_code set not null;

create unique index if not exists waitlist_signups_referral_code_key
  on public.waitlist_signups (referral_code);

create index if not exists waitlist_signups_referred_by_idx
  on public.waitlist_signups (referred_by);
