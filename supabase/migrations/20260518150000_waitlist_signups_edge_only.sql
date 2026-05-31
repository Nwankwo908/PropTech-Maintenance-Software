-- Waitlist signups should go through the join-waitlist Edge Function (insert + confirmation email).
drop policy if exists waitlist_signups_insert_public on public.waitlist_signups;
