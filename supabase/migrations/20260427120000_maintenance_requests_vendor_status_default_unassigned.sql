-- New rows start without a vendor; assignVendorAndNotify moves to pending_accept once assigned_vendor_id is set.

alter table public.maintenance_requests
  alter column vendor_work_status set default 'unassigned';
