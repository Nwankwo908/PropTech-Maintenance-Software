-- Tenant-facing request reference. Existing tickets keep the first 8 hex
-- characters already used in texts (676FE1DD, 30A0B8CC). A later ticket that
-- shares that prefix gets a longer ref instead of changing the earlier one.

alter table public.maintenance_requests
  add column if not exists resident_request_ref text;

create or replace function public.assign_resident_request_ref()
returns trigger
language plpgsql
as $$
declare
  hex text;
  n int;
  candidate text;
begin
  if new.resident_request_ref is not null and length(btrim(new.resident_request_ref)) >= 8 then
    new.resident_request_ref := upper(btrim(new.resident_request_ref));
    return new;
  end if;

  hex := upper(replace(new.id::text, '-', ''));
  n := 8;
  loop
    candidate := substr(hex, 1, n);
    exit when not exists (
      select 1
      from public.maintenance_requests
      where resident_request_ref = candidate
         or resident_request_ref like candidate || '%'
    );
    if n >= length(hex) then
      candidate := hex;
      exit;
    end if;
    n := least(length(hex), n + 4);
  end loop;

  new.resident_request_ref := candidate;
  return new;
end;
$$;

drop trigger if exists maintenance_requests_assign_resident_request_ref
  on public.maintenance_requests;
create trigger maintenance_requests_assign_resident_request_ref
  before insert on public.maintenance_requests
  for each row
  execute function public.assign_resident_request_ref();

do $$
declare
  rec record;
  hex text;
  n int;
  candidate text;
begin
  for rec in
    select id
    from public.maintenance_requests
    where resident_request_ref is null
    order by created_at, id
  loop
    hex := upper(replace(rec.id::text, '-', ''));
    n := 8;
    loop
      candidate := substr(hex, 1, n);
      exit when not exists (
        select 1
        from public.maintenance_requests
        where resident_request_ref = candidate
           or resident_request_ref like candidate || '%'
      );
      if n >= length(hex) then
        candidate := hex;
        exit;
      end if;
      n := least(length(hex), n + 4);
    end loop;
    update public.maintenance_requests
    set resident_request_ref = candidate
    where id = rec.id
      and resident_request_ref is null;
  end loop;
end $$;

create unique index if not exists maintenance_requests_resident_request_ref_uidx
  on public.maintenance_requests (resident_request_ref);
