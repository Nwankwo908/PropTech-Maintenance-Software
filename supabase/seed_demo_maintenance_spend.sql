-- Approved maintenance invoices for Demo Property Management — analytics + MTD spend.
-- Run after seed_demo_landlord_account.sql and migration 20260616120000_maintenance_invoices_spend.sql
--
-- Uses dates relative to the current calendar month so Property Health cards, property
-- detail MTD KPI, and Analytics tab always show non-zero demo spend after re-seeding.

do $$
declare
  demo_landlord uuid := 'de300000-0000-4000-8000-000000000001';
  month_start timestamptz := date_trunc('month', now());
  year_start timestamptz := date_trunc('year', now());
begin
  if to_regclass('public.maintenance_invoices') is null then
    raise notice 'maintenance_invoices missing — run migrations first';
    return;
  end if;

  -- Disambiguate unit labels that repeat across buildings (103, 204, 107, 305).
  -- maintenance_request_enriched prefers rows where mr.unit contains the building name.
  update public.maintenance_requests mr
  set unit = v.unit_label
  from (
    values
      (md5('ulo-demo-ticket-17')::uuid, 'Oakwood Apartments · 304'),
      (md5('ulo-demo-ticket-18')::uuid, 'Oakwood Apartments · 103'),
      (md5('ulo-demo-ticket-19')::uuid, 'Oakwood Apartments · 204'),
      (md5('ulo-demo-ticket-20')::uuid, 'Birch Tower · 107'),
      (md5('ulo-demo-ticket-21')::uuid, 'Birch Tower · 410'),
      (md5('ulo-demo-ticket-22')::uuid, 'Maple Heights · 207'),
      (md5('ulo-demo-ticket-23')::uuid, 'Maple Heights · 105'),
      (md5('ulo-demo-ticket-24')::uuid, 'Pine Ridge · 204'),
      (md5('ulo-demo-ticket-25')::uuid, 'Cedar Court · 305'),
      (md5('ulo-demo-ticket-26')::uuid, 'Willow Park · 103'),
      (md5('ulo-demo-ticket-29')::uuid, 'Pine Ridge · 301')
  ) as v(ticket_id, unit_label)
  where mr.id = v.ticket_id
    and mr.landlord_id = demo_landlord;

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
    md5('ulo-demo-inv-' || cfg.ticket_id::text)::uuid,
    demo_landlord,
    cfg.ticket_id,
    mr.assigned_vendor_id,
    'DEMO-' || upper(substr(cfg.ticket_id::text, 1, 8)),
    cfg.labor,
    cfg.material,
    cfg.tax,
    'approved',
    cfg.approved_at - interval '1 day',
    cfg.approved_at,
    jsonb_build_object(
      'seed', 'demo_maintenance_spend',
      'building', cfg.building,
      'spend_class', cfg.spend_class
    )
  from (
    values
      -- YTD prior months (one job per month for chart history)
      (md5('ulo-demo-ticket-23')::uuid, 'Maple Heights',     'proactive', 320::numeric, 140::numeric, 38::numeric, year_start + interval '1 month  5 days'),
      (md5('ulo-demo-ticket-21')::uuid, 'Birch Tower',       'proactive', 260::numeric,  95::numeric, 22::numeric, year_start + interval '2 months 8 days'),
      (md5('ulo-demo-ticket-19')::uuid, 'Oakwood Apartments','proactive', 280::numeric, 110::numeric, 28::numeric, year_start + interval '3 months 4 days'),
      (md5('ulo-demo-ticket-25')::uuid, 'Cedar Court',       'proactive', 240::numeric,  85::numeric, 20::numeric, year_start + interval '4 months 11 days'),
      (md5('ulo-demo-ticket-29')::uuid, 'Pine Ridge',        'reactive',  380::numeric, 160::numeric, 42::numeric, year_start + interval '5 months 6 days'),
      -- Current month (MTD) — varied amounts per building for Property Health cards
      (md5('ulo-demo-ticket-17')::uuid, 'Oakwood Apartments','reactive',  420::numeric, 180::numeric, 45::numeric, month_start + interval '2 days 10 hours'),
      (md5('ulo-demo-ticket-18')::uuid, 'Oakwood Apartments','proactive', 185::numeric,  72::numeric, 18::numeric, month_start + interval '9 days 14 hours'),
      (md5('ulo-demo-ticket-20')::uuid, 'Birch Tower',       'reactive',  890::numeric, 320::numeric, 97::numeric, month_start + interval '4 days 16 hours'),
      (md5('ulo-demo-ticket-22')::uuid, 'Maple Heights',     'proactive', 210::numeric,  95::numeric, 24::numeric, month_start + interval '7 days 9 hours'),
      (md5('ulo-demo-ticket-24')::uuid, 'Pine Ridge',        'proactive', 165::numeric,  58::numeric, 15::numeric, month_start + interval '11 days 11 hours'),
      (md5('ulo-demo-ticket-26')::uuid, 'Willow Park',       'reactive',  650::numeric, 410::numeric, 84::numeric, month_start + interval '6 days 8 hours')
  ) as cfg(ticket_id, building, spend_class, labor, material, tax, approved_at)
  inner join public.maintenance_requests mr
    on mr.id = cfg.ticket_id
   and mr.landlord_id = demo_landlord
  on conflict (maintenance_request_id) do update
    set
      labor_cost = excluded.labor_cost,
      material_cost = excluded.material_cost,
      tax_amount = excluded.tax_amount,
      status = 'approved',
      approved_at = excluded.approved_at,
      submitted_at = excluded.submitted_at,
      updated_at = now(),
      metadata = excluded.metadata;

  update public.maintenance_requests mr
  set
    spend_status = 'recognized',
    recognized_spend_at = inv.approved_at,
    recognized_spend_amount = inv.total_cost,
    completed_at = inv.approved_at - interval '1 day'
  from public.maintenance_invoices inv
  where inv.maintenance_request_id = mr.id
    and inv.landlord_id = demo_landlord
    and inv.status = 'approved';

  raise notice 'Demo maintenance spend: % approved invoices (% MTD this month)',
    (select count(*) from public.maintenance_invoices where landlord_id = demo_landlord and status = 'approved'),
    (select count(*)
     from public.maintenance_invoices
     where landlord_id = demo_landlord
       and status = 'approved'
       and approved_at >= month_start);
end $$;
