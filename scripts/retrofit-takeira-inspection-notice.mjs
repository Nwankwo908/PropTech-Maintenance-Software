#!/usr/bin/env node
/**
 * Retrofit Takeira's 10/8 HABC notice + WO-C1E9 onto inspection_reports
 * (letter_type=tenant_notice) with the screenshot as source_document.
 *
 * APPLY=1 to write. Default is dry-run.
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const APPLY = process.env.APPLY === '1'
const LANDLORD_ID =
  process.env.LANDLORD_ID?.trim() || 'de300000-0000-4000-8000-000000000003'
const TICKET_ID =
  process.env.TICKET_ID?.trim() || 'c1e9b580-fc6a-46b9-965a-11c0b4a15673'
const RESIDENT_ID =
  process.env.RESIDENT_ID?.trim() || 'd8059b3a-f03c-4630-97dc-a8f539522256'
const INSPECTION_DATE = process.env.INSPECTION_DATE?.trim() || '2026-10-08'
const HABC_PATH_SNIP =
  process.env.HABC_PATH_SNIP?.trim() || '1790963105184-0.jpg'

const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
} catch {}

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const keys = JSON.parse(
    execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve service_role key')
  return sr.api_key
}

const supabase = createClient(
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  await serviceRoleKey(),
  { auth: { persistSession: false } },
)

const { data: ticket, error: ticketErr } = await supabase
  .from('maintenance_requests')
  .select(
    'id, resident_id, unit_id, property_id, photo_paths, inspection_report_id, due_at, description, issue_category',
  )
  .eq('id', TICKET_ID)
  .maybeSingle()
if (ticketErr || !ticket) throw new Error(ticketErr?.message || 'ticket not found')

const unitId = ticket.unit_id
const propertyId = ticket.property_id
if (!unitId || !propertyId) throw new Error('ticket missing unit_id/property_id')

const paths = Array.isArray(ticket.photo_paths) ? ticket.photo_paths.map(String) : []
const habcPath = paths.find((p) => p.includes(HABC_PATH_SNIP)) || null
const remainingPaths = paths.filter((p) => !p.includes(HABC_PATH_SNIP))

const { data: existing } = await supabase
  .from('inspection_reports')
  .select('id, source_document_id, inspection_date, letter_type, status')
  .eq('landlord_id', LANDLORD_ID)
  .eq('unit_id', unitId)
  .eq('letter_type', 'tenant_notice')
  .eq('inspection_date', INSPECTION_DATE)
  .in('status', ['open', 'in_progress'])
  .maybeSingle()

const plan = {
  apply: APPLY,
  ticketId: TICKET_ID,
  unitId,
  propertyId,
  habcPath,
  remainingPhotoCount: remainingPaths.length,
  existingReportId: existing?.id ?? null,
  willCreateReport: !existing?.id,
  willCreateSourceDoc: Boolean(habcPath) && !existing?.source_document_id,
  willLinkTicket: ticket.inspection_report_id !== (existing?.id ?? 'NEW'),
  willMoveHabcOffTicket: Boolean(habcPath),
}

console.log(JSON.stringify({ plan, ticketBefore: ticket }, null, 2))

if (!APPLY) {
  console.log('Dry-run only. Re-run with APPLY=1 to write.')
  process.exit(0)
}

// Ensure letter_type constraint allows tenant_notice (migration may not be applied yet).
try {
  await supabase.rpc('exec_sql', {
    query: `
      alter table public.inspection_reports drop constraint if exists inspection_reports_letter_type_check;
      alter table public.inspection_reports add constraint inspection_reports_letter_type_check
        check (letter_type in ('standard_fail', 'hap_abatement', 'tenant_notice'));
    `,
  })
} catch {
  // Constraint change may require dashboard SQL — continue; insert will fail loudly if blocked.
}

let sourceDocumentId = existing?.source_document_id ?? null
if (habcPath && !sourceDocumentId) {
  const fileName = habcPath.split('/').pop() || 'habc-inspection-notice.jpg'
  const { data: doc, error: docErr } = await supabase
    .from('inspection_source_documents')
    .insert({
      landlord_id: LANDLORD_ID,
      property_id: propertyId,
      unit_id: unitId,
      storage_bucket: 'maintenance-uploads',
      storage_path: habcPath,
      file_name: fileName,
      content_type: 'image/jpeg',
      source_channel: 'sms',
    })
    .select('id')
    .maybeSingle()
  if (docErr || !doc?.id) throw new Error(docErr?.message || 'source doc insert failed')
  sourceDocumentId = doc.id
}

let reportId = existing?.id ?? null
if (!reportId) {
  const { data: report, error: reportErr } = await supabase
    .from('inspection_reports')
    .insert({
      landlord_id: LANDLORD_ID,
      property_id: propertyId,
      unit_id: unitId,
      inspection_date: INSPECTION_DATE,
      inspection_dates: [INSPECTION_DATE],
      letter_type: 'tenant_notice',
      is_abated: false,
      emergency_item_count: 0,
      standard_item_count: 1,
      source_document_id: sourceDocumentId,
      status: 'open',
      conversation_id: '30a07f48-214e-4b87-857c-791ac8be3038',
    })
    .select('id')
    .maybeSingle()
  if (reportErr || !report?.id) throw new Error(reportErr?.message || 'report insert failed')
  reportId = report.id
} else if (sourceDocumentId && !existing?.source_document_id) {
  await supabase
    .from('inspection_reports')
    .update({ source_document_id: sourceDocumentId })
    .eq('id', reportId)
}

const ticketPatch = {
  inspection_report_id: reportId,
  due_at: `${INSPECTION_DATE}T20:00:00.000Z`,
  photo_paths: remainingPaths,
  resident_id: ticket.resident_id || RESIDENT_ID,
}

const { error: ticketUpdateErr } = await supabase
  .from('maintenance_requests')
  .update(ticketPatch)
  .eq('id', TICKET_ID)
if (ticketUpdateErr) throw new Error(ticketUpdateErr.message)

// Bump standard_item_count to sibling count
const { data: siblings } = await supabase
  .from('maintenance_requests')
  .select('id')
  .eq('inspection_report_id', reportId)
await supabase
  .from('inspection_reports')
  .update({ standard_item_count: (siblings ?? []).length })
  .eq('id', reportId)

const { data: afterTicket } = await supabase
  .from('maintenance_requests')
  .select('id, inspection_report_id, photo_paths, due_at, resident_id')
  .eq('id', TICKET_ID)
  .maybeSingle()
const { data: afterReport } = await supabase
  .from('inspection_reports')
  .select(
    'id, letter_type, inspection_date, source_document_id, standard_item_count, status, unit_id, property_id',
  )
  .eq('id', reportId)
  .maybeSingle()

console.log(JSON.stringify({ ok: true, afterTicket, afterReport, siblings: siblings ?? [] }, null, 2))
