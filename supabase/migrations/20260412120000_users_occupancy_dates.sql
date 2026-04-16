-- Optional dates for assign-occupancy flow (Add Occupancy modal).
-- Apply with: supabase db push   (or your migration runner)
-- Client: AdminUserManagementDashboard selects these on resident load/insert/assign; Add Occupancy updates them.
alter table public.users
  add column if not exists move_in_date date,
  add column if not exists lease_end_date date;
