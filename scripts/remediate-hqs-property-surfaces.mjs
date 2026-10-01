#!/usr/bin/env node
/**
 * One-time / idempotent remediation: backfill HQS source-doc property/unit,
 * PM compliance inspection tasks, and home_data_graph_ingest audit rows
 * for confirmed inspection_reports (e.g. IR-8AC8).
 *
 * Usage:
 *   node scripts/remediate-hqs-property-surfaces.mjs
 *   node scripts/remediate-hqs-property-surfaces.mjs --report 8ac8ee35-9f78-44ec-85a8-97b90442e54c
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'mzpqwuizhiaczxcnmxbt'

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    return process.env.SUPABASE_ACCESS_TOKEN.trim()
  }
  const p = path.join(process.env.HOME || '', '.supabase', 'access-token')
  return fs.readFileSync(p, 'utf8').trim()
}

async function sql(token, query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const reportArg = process.argv.includes('--report')
  ? process.argv[process.argv.indexOf('--report') + 1]
  : null

const token = loadToken()
const reportClause = reportArg
  ? `and r.id = '${String(reportArg).replace(/'/g, "''")}'::uuid`
  : ''

const query = `
with filled as (
  update inspection_reports r
  set property_id = u.property_id
  from units u
  where u.id = r.unit_id
    and r.property_id is null
    and u.property_id is not null
    and r.status <> 'cancelled'
    ${reportClause}
  returning r.id
),
reports as (
  select
    r.id,
    r.landlord_id,
    coalesce(r.property_id, u.property_id) as property_id,
    r.unit_id,
    r.source_document_id,
    r.letter_type,
    r.is_abated,
    r.emergency_item_count,
    r.standard_item_count,
    r.reinspection_date,
    r.inspection_date,
    u.unit_label,
    u.building
  from inspection_reports r
  join units u on u.id = r.unit_id
  where r.status <> 'cancelled'
  ${reportClause}
),
src as (
  update inspection_source_documents d
  set
    unit_id = reports.unit_id,
    property_id = coalesce(reports.property_id, d.property_id)
  from reports
  where d.id = reports.source_document_id
    and d.landlord_id = reports.landlord_id
    and (
      d.unit_id is distinct from reports.unit_id
      or d.property_id is distinct from coalesce(reports.property_id, d.property_id)
    )
  returning d.id
),
pm_ins as (
  insert into preventive_maintenance_tasks (
    landlord_id, title, task_kind, due_at, status, building, unit_label, metadata
  )
  select
    reports.landlord_id,
    case
      when nullif(trim(reports.unit_label), '') is not null
        then 'HQS compliance re-inspection — Unit ' || trim(reports.unit_label)
      else 'HQS compliance re-inspection'
    end,
    'inspection',
    coalesce(
      (reports.reinspection_date + time '17:00') at time zone 'UTC',
      (reports.inspection_date + 30 + time '17:00') at time zone 'UTC',
      now() + interval '30 days'
    ),
    'scheduled',
    reports.building,
    reports.unit_label,
    jsonb_build_object(
      'source', 'hqs_letter',
      'inspection_report_id', reports.id::text,
      'source_document_id', reports.source_document_id::text,
      'letter_type', reports.letter_type,
      'is_abated', reports.is_abated,
      'emergency_item_count', reports.emergency_item_count,
      'standard_item_count', reports.standard_item_count
    )
  from reports
  where not exists (
    select 1 from preventive_maintenance_tasks p
    where p.landlord_id = reports.landlord_id
      and p.status <> 'cancelled'
      and p.metadata->>'inspection_report_id' = reports.id::text
  )
  returning id
),
hdg_ins as (
  insert into home_data_graph_ingest (
    property_id, landlord_id, provider, provider_record_id, raw_payload, fetched_at
  )
  select
    reports.property_id,
    reports.landlord_id,
    'manual',
    'hqs-letter:' || reports.id::text,
    jsonb_build_object(
      'kind', 'hqs_inspection_letter',
      'inspection_report_id', reports.id::text,
      'source_document_id', reports.source_document_id::text,
      'unit_id', reports.unit_id::text,
      'unit_label', reports.unit_label,
      'letter_type', reports.letter_type,
      'is_abated', reports.is_abated,
      'emergency_item_count', reports.emergency_item_count,
      'standard_item_count', reports.standard_item_count
    ),
    now()
  from reports
  where reports.property_id is not null
    and not exists (
      select 1 from home_data_graph_ingest h
      where h.property_id = reports.property_id
        and h.provider = 'manual'
        and h.provider_record_id = 'hqs-letter:' || reports.id::text
    )
  returning id
)
select
  (select count(*) from reports) as reports,
  (select count(*) from filled) as reports_property_backfilled,
  (select count(*) from src) as source_docs_updated,
  (select count(*) from pm_ins) as pm_tasks_created,
  (select count(*) from hdg_ins) as hdg_ingests_created;
`

const result = await sql(token, query)
console.log(JSON.stringify(result, null, 2))
