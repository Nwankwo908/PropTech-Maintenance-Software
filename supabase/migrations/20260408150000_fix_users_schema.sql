-- Residents created in the admin UI exist before a matching auth signup.
-- supabase_user_id must be nullable until the resident links (or logs in with) an account.

alter table public.users
  add column if not exists supabase_user_id uuid references auth.users (id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'supabase_user_id'
      and is_nullable = 'NO'
  ) then
    execute 'alter table public.users alter column supabase_user_id drop not null';
  end if;
end $$;

alter table public.users
  add column if not exists role text not null default 'resident';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'role'
  ) then
    execute $sql$alter table public.users alter column role set default 'resident'$sql$;
  end if;
end $$;
