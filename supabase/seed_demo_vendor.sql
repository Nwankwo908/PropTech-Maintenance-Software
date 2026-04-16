-- Optional: run after migrations to create a demo vendor for local/staging.
-- Example: psql $DATABASE_URL -f supabase/seed_demo_vendor.sql
-- Or paste into Supabase SQL Editor.
--
-- Assignment uses issue_category → specialist match → generalists (null/empty category) → any active.
-- Leave category null for a demo generalist, or set to 'appliance' | 'plumbing' | 'electrical'.

insert into public.vendors (name, category, email, phone, notification_channel, active, portal_api_key)
values (
  'ABC Maintenance Co.',
  null,
  'vendor-notify-demo@example.com',
  '+15555550100',
  'both',
  true,
  gen_random_uuid()
);

-- If you need a stable vendor id for local testing, use a fixed uuid:
-- insert into public.vendors (id, name, email, phone, notification_channel, active)
-- values (
--   'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
--   'ABC Maintenance Co.',
--   'vendor@example.com',
--   '+15555550100',
--   'email',
--   true
-- );
