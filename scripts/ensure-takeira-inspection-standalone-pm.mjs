#!/usr/bin/env node
/**
 * Ensure Takeira's tenant_notice inspection (1a992b5a…) has a PM Compliance
 * row and remains unlinked from WO-C1E9 / WO-5FA6.
 *
 * APPLY=1 to insert missing PM task. Default is report-only.
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { planStandaloneInspectionPmComplianceTask } from '../shared/maintenance/standaloneInspectionTask.ts'
import { shouldShowStandaloneInspectionActiveTask } from '../shared/maintenance/standaloneInspectionTask.ts'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const APPLY = process.env.APPLY === '1'
const LANDLORD_ID =
  process.env.LANDLORD_ID?.trim() || 'de300000-0000-4000-8000-000000000003'
const REPORT_ID =
  process.env.REPORT_ID?.trim() || '1a992b5a-9075-49ba-83bc-7ebb0b45d746'
const PAINT_TICKET =
  process.env.PAINT_TICKET?.trim() || 'c1e9b580-fc6a-46b9-965a-11c0b4a15673'
const PEST_TICKET = process.env.PEST_TICKET?.trim() || null

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

const { data: report, error: reportErr } = await supabase
  .from('inspection_reports')
  .select(
    'id, letter_type, inspection_date, status, unit_id, property_id, source_document_id, emergency_item_count, standard_item_count',
  )
  .eq('id', REPORT_ID)
  .maybeSingle()
if (reportErr || !report) throw new Error(reportErr?.message || 'report not found')

const [{ data: linked }, { data: unit }, { data: pmTasks }, { data: paint }, { data: pestTickets }] =
  await Promise.all([
    supabase
      .from('maintenance_requests')
      .select('id, request_number, inspection_report_id, description, issue_category')
      .eq('inspection_report_id', REPORT_ID),
    report.unit_id
      ? supabase
          .from('units')
          .select('id, unit_label, building')
          .eq('id', report.unit_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('preventive_maintenance_tasks')
      .select('id, title, due_at, status, metadata')
      .eq('landlord_id', LANDLORD_ID)
      .contains('metadata', { inspection_report_id: REPORT_ID })
      .neq('status', 'cancelled'),
    supabase
      .from('maintenance_requests')
      .select('id, request_number, inspection_report_id, description, issue_category, vendor_work_status')
      .eq('id', PAINT_TICKET)
      .maybeSingle(),
    PEST_TICKET
      ? supabase
          .from('maintenance_requests')
          .select('id, request_number, inspection_report_id, description, issue_category')
          .eq('id', PEST_TICKET)
          .maybeSingle()
      : supabase
          .from('maintenance_requests')
          .select('id, request_number, inspection_report_id, description, issue_category')
          .eq('landlord_id', LANDLORD_ID)
          .ilike('description', '%roach%')
          .limit(5),
  ])

const showStandalone = shouldShowStandaloneInspectionActiveTask({
  letterType: report.letter_type,
  emergencyItemCount: Number(report.emergency_item_count ?? 0),
  standardItemCount: Number(report.standard_item_count ?? 0),
  linkedWorkOrderCount: (linked ?? []).length,
})

const plan = planStandaloneInspectionPmComplianceTask({
  inspectionReportId: REPORT_ID,
  sourceDocumentId: report.source_document_id,
  unitLabel: unit?.unit_label ?? null,
  building: unit?.building ?? null,
  letterType: report.letter_type,
  inspectionDate: report.inspection_date,
})

let pmInserted = false
if (APPLY && !(pmTasks ?? []).length && showStandalone) {
  const { error } = await supabase.from('preventive_maintenance_tasks').insert({
    landlord_id: LANDLORD_ID,
    title: plan.title,
    task_kind: plan.taskKind,
    due_at: plan.dueAtIso,
    status: 'scheduled',
    building: plan.building,
    unit_label: plan.unitLabel,
    metadata: plan.metadata,
  })
  if (error) throw error
  pmInserted = true
}

const out = {
  apply: APPLY,
  report: {
    id: report.id,
    letterType: report.letter_type,
    inspectionDate: report.inspection_date,
    status: report.status,
    linkedWoCount: (linked ?? []).length,
    showStandaloneActiveTask: showStandalone,
  },
  pmCompliance: {
    existing: (pmTasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.due_at,
      status: t.status,
    })),
    wouldInsert: !(pmTasks ?? []).length && showStandalone,
    inserted: pmInserted,
    planTitle: plan.title,
    planDueAt: plan.dueAtIso,
  },
  paintTicket: paint
    ? {
        id: paint.id,
        requestNumber: paint.request_number,
        inspectionReportId: paint.inspection_report_id,
        unlinked: paint.inspection_report_id == null,
      }
    : null,
  pestTickets: Array.isArray(pestTickets)
    ? pestTickets.map((t) => ({
        id: t.id,
        requestNumber: t.request_number,
        inspectionReportId: t.inspection_report_id,
        unlinked: t.inspection_report_id == null,
      }))
    : pestTickets
      ? [
          {
            id: pestTickets.id,
            requestNumber: pestTickets.request_number,
            inspectionReportId: pestTickets.inspection_report_id,
            unlinked: pestTickets.inspection_report_id == null,
          },
        ]
      : [],
}

console.log(JSON.stringify(out, null, 2))
