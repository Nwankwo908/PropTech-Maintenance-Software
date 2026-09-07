-- Edit Resident saves the email column even when it did not change.
-- A global unique on public.users.email treats blank addresses as duplicates,
-- so saving a tenant with an empty (or shared blank) email fails.

alter table public.users drop constraint if exists users_email_key;

drop index if exists public.users_email_key;
drop index if exists public.users_email_idx;
drop index if exists public.users_email_unique;

-- Real addresses may still be unique per landlord. Skip if duplicates already exist.
do $$
begin
  if exists (
    select 1
    from public.users
    where btrim(coalesce(email, '')) <> ''
    group by landlord_id, lower(btrim(email))
    having count(*) > 1
  ) then
    return;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'users_landlord_nonempty_email_uidx'
  ) then
    execute $sql$
      create unique index users_landlord_nonempty_email_uidx
        on public.users (landlord_id, lower(btrim(email)))
        where btrim(email) <> ''
    $sql$;
  end if;
end $$;
