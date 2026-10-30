-- Portal membership confers access only to the member's own landlord account.
-- Preserve vendor self-read; directory writes remain landlord/staff controlled.
do $$ declare p record; begin for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'vendors' loop execute format('drop policy %I on public.vendors', p.policyname); end loop; end $$;
create policy vendors_select_owned on public.vendors for select to authenticated
 using (public.can_access_landlord(landlord_id) or public.is_platform_staff()
        or auth_user_id = auth.uid()
        or (coalesce(auth.jwt()->>'email','') <> '' and lower(trim(email)) = lower(trim(auth.jwt()->>'email'))));
create policy vendors_insert_owned on public.vendors for insert to authenticated
 with check (public.can_access_landlord(landlord_id) or public.is_platform_staff());
create policy vendors_update_owned on public.vendors for update to authenticated
 using (public.can_access_landlord(landlord_id) or public.is_platform_staff())
 with check (public.can_access_landlord(landlord_id) or public.is_platform_staff());
create policy vendors_delete_owned on public.vendors for delete to authenticated
 using (public.can_access_landlord(landlord_id) or public.is_platform_staff());

do $$ declare p record; begin for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'support_tickets' loop execute format('drop policy %I on public.support_tickets', p.policyname); end loop; end $$;
create policy support_tickets_select_owned on public.support_tickets for select to authenticated
 using (public.can_access_landlord(landlord_id) or public.is_platform_staff());
-- Aggregate cross-customer signals are internal only.
do $$ declare p record; begin for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'support_ticket_signature_signals' loop execute format('drop policy %I on public.support_ticket_signature_signals', p.policyname); end loop; end $$;
create policy support_ticket_signals_platform_select on public.support_ticket_signature_signals
 for select to authenticated using (public.is_platform_staff());
drop trigger if exists trg_support_ticket_landlord_immutable on public.support_tickets;
create trigger trg_support_ticket_landlord_immutable before update of landlord_id
 on public.support_tickets for each row execute function public.prevent_landlord_id_reassignment();
