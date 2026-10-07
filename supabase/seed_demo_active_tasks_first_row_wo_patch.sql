-- Tip step 7 first-row cutouts: prefer work orders over inspection cards.
-- 1) Completed: completed HVAC WO ahead of annual inspection
-- 2) In Progress: accepted dishwasher WO ahead of escalated inspection
-- Idempotent.

update public.workflow_runs
set
  started_at = now() - interval '1 day',
  completed_at = now() - interval '16 hours'
where id = md5('ulo-demo-run-maint-5')::uuid
  and landlord_id = 'de300000-0000-4000-8000-000000000001';

update public.maintenance_requests
set created_at = now() - interval '2 days'
where id = md5('ulo-demo-ticket-20')::uuid
  and landlord_id = 'de300000-0000-4000-8000-000000000001';

-- In Progress first row (live demo often has a newer escalated inspection above this WO)
update public.workflow_runs
set
  started_at = now() - interval '90 minutes',
  status = 'active',
  current_step = 'awaiting_vendor_schedule'
where id = md5('ulo-demo-run-maint-7')::uuid
  and landlord_id = 'de300000-0000-4000-8000-000000000001';

update public.maintenance_requests
set
  created_at = now() - interval '3 hours',
  vendor_work_status = 'accepted'
where id = md5('ulo-demo-ticket-31')::uuid
  and landlord_id = 'de300000-0000-4000-8000-000000000001';

-- Assigned first row: pending-accept HVAC WO ahead of move-in / inspection
update public.workflow_runs
set
  started_at = now() - interval '2 hours',
  status = 'active',
  current_step = 'awaiting_vendor_accept',
  current_stage = 'acted'
where id = md5('ulo-demo-run-maint-2')::uuid
  and landlord_id = 'de300000-0000-4000-8000-000000000001';

update public.maintenance_requests
set
  created_at = now() - interval '3 hours',
  vendor_work_status = 'pending_accept',
  assigned_vendor_id = md5('ulo-demo-vendor-summit-hvac')::uuid,
  assigned_at = now() - interval '2 hours',
  auto_reassign_last_outcome = null
where id = md5('ulo-demo-ticket-03')::uuid
  and landlord_id = 'de300000-0000-4000-8000-000000000001';
