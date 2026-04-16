-- New maintenance_requests rows must not default to pending_accept without a vendor, or
-- check constraint require_vendor_for_progress rejects the INSERT.
-- Idempotent: safe if 20260427120000_maintenance_requests_vendor_status_default_unassigned.sql already ran.

alter table public.maintenance_requests
  alter column vendor_work_status set default 'unassigned';
