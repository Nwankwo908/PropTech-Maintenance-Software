-- Approved maintenance invoices for Demo Property Management analytics chart.
-- Run after seed_demo_landlord_account.sql and migration 20260616120000_maintenance_invoices_spend.sql

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  now_ts timestamptz := now();
begin
  if to_regclass('public.maintenance_invoices') is null then
    raise notice 'maintenance_invoices missing — run migrations first';
    return;
  end if;

  insert into public.maintenance_invoices (
    id,
    landlord_id,
    maintenance_request_id,
    vendor_id,
    invoice_number,
    labor_cost,
    material_cost,
    tax_amount,
    status,
    submitted_at,
    approved_at,
    metadata
  )
  select
    md5('ulo-demo-inv-' || mr.id::text)::uuid,
    demo_landlord,
    mr.id,
    mr.assigned_vendor_id,
    'DEMO-' || upper(substr(mr.id::text, 1, 8)),
    case mr.id
      when md5('ulo-demo-ticket-17')::uuid then 420
      when md5('ulo-demo-ticket-20')::uuid then 890
      when md5('ulo-demo-ticket-26')::uuid then 650
      else 280
    end,
    case mr.id
      when md5('ulo-demo-ticket-17')::uuid then 180
      when md5('ulo-demo-ticket-20')::uuid then 320
      when md5('ulo-demo-ticket-26')::uuid then 410
      else 95
    end,
    case mr.id
      when md5('ulo-demo-ticket-17')::uuid then 45
      when md5('ulo-demo-ticket-20')::uuid then 97
      when md5('ulo-demo-ticket-26')::uuid then 84
      else 22
    end,
    'approved',
    mr.created_at + interval '2 days',
    coalesce(mr.completed_at, mr.created_at + interval '3 days'),
    jsonb_build_object('seed', 'demo_maintenance_spend')
  from public.maintenance_requests mr
  where mr.landlord_id = demo_landlord
    and mr.vendor_work_status = 'completed'
    and mr.id in (
      md5('ulo-demo-ticket-17')::uuid,
      md5('ulo-demo-ticket-18')::uuid,
      md5('ulo-demo-ticket-19')::uuid,
      md5('ulo-demo-ticket-20')::uuid,
      md5('ulo-demo-ticket-21')::uuid,
      md5('ulo-demo-ticket-22')::uuid,
      md5('ulo-demo-ticket-23')::uuid,
      md5('ulo-demo-ticket-24')::uuid,
      md5('ulo-demo-ticket-25')::uuid,
      md5('ulo-demo-ticket-26')::uuid
    )
  on conflict (maintenance_request_id) do update
    set
      labor_cost = excluded.labor_cost,
      material_cost = excluded.material_cost,
      tax_amount = excluded.tax_amount,
      status = 'approved',
      approved_at = excluded.approved_at,
      submitted_at = excluded.submitted_at,
      updated_at = now();

  update public.maintenance_requests mr
  set
    spend_status = 'recognized',
    recognized_spend_at = inv.approved_at,
    recognized_spend_amount = inv.total_cost,
    completed_at = coalesce(mr.completed_at, inv.approved_at - interval '1 day')
  from public.maintenance_invoices inv
  where inv.maintenance_request_id = mr.id
    and inv.landlord_id = demo_landlord
    and inv.status = 'approved';

  raise notice 'Demo maintenance spend: % approved invoices',
    (select count(*) from public.maintenance_invoices where landlord_id = demo_landlord and status = 'approved');
end $$;
