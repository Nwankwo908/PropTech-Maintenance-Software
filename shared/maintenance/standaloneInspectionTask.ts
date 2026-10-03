/**
 * Standalone Active Tasks + PM Compliance visibility for inspection_reports
 * that have no itemized checklist (tenant notices, manual entries with zero
 * fail items). Landlord HQS letters with fail items keep the existing N-of-M
 * visit card only — never a duplicate standalone task.
 */
export type StandaloneInspectionLetterType =
  | 'tenant_notice'
  | 'standard_fail'
  | 'hap_abatement'
  | string

export type ZeroChecklistInspectionInput = {
  letterType?: string | null
  emergencyItemCount?: number | null
  standardItemCount?: number | null
  /** Count of maintenance_requests.inspection_report_id = this report. */
  linkedWorkOrderCount?: number | null
}

/**
 * True when this inspection should get a standalone Active Tasks card.
 *
 * Trigger = zero itemized checklist at creation (tenant_notice, or any other
 * path with emergency+standard counts of 0). Landlord HQS letters
 * (`standard_fail` / `hap_abatement`) always use the existing N-of-M visit
 * card — never a duplicate standalone task. Linked WO count does not decide
 * visibility; auto-linking WOs onto tenant notices is forbidden separately.
 */
export function shouldShowStandaloneInspectionActiveTask(
  input: ZeroChecklistInspectionInput,
): boolean {
  const letter = String(input.letterType ?? '')
    .trim()
    .toLowerCase()
  // Explicit HQS fail / abatement letters always use the existing visit-group
  // path; never add a parallel standalone card.
  if (letter === 'standard_fail' || letter === 'hap_abatement') return false

  if (letter === 'tenant_notice') return true

  // Manual / future paths: no letter type or unknown, and no itemized counts.
  const emergency = Number(input.emergencyItemCount ?? 0)
  const standard = Number(input.standardItemCount ?? 0)
  return (Number.isFinite(emergency) ? emergency : 0) +
      (Number.isFinite(standard) ? standard : 0) ===
    0
}

export function formatInspectionDateLabel(iso: string | null | undefined): string | null {
  const day = String(iso ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const parsed = new Date(`${day}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function letterTypeInspectionLabel(letterType: string | null | undefined): string {
  const letter = String(letterType ?? '')
    .trim()
    .toLowerCase()
  if (letter === 'tenant_notice') return 'Tenant notice'
  if (letter === 'hap_abatement') return 'HAP abatement'
  if (letter === 'standard_fail') return 'HQS'
  if (!letter) return 'Inspection'
  return letter.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Active Tasks title: "[Letter type] inspection — [date]" */
export function standaloneInspectionActiveTaskTitle(input: {
  letterType?: string | null
  inspectionDate?: string | null
}): string {
  const kind = letterTypeInspectionLabel(input.letterType)
  const dateLabel = formatInspectionDateLabel(input.inspectionDate)
  if (dateLabel) return `${kind} inspection — ${dateLabel}`
  return `${kind} inspection`
}

export function standaloneInspectionNextStep(): string {
  return 'Prepare for inspection'
}

/** Synthetic Active Tasks / dashboard row id (not a workflow_runs UUID). */
export function standaloneInspectionTaskRowId(inspectionReportId: string): string {
  return `inspection-report:${inspectionReportId}`
}

export function isStandaloneInspectionTaskRowId(id: string | null | undefined): boolean {
  return String(id ?? '').startsWith('inspection-report:')
}

export function inspectionReportIdFromStandaloneTaskRowId(
  id: string | null | undefined,
): string | null {
  const raw = String(id ?? '')
  if (!raw.startsWith('inspection-report:')) return null
  const reportId = raw.slice('inspection-report:'.length).trim()
  return reportId || null
}

/** Due at end-of-day UTC on the inspection date (not inspection+30). */
export function standaloneInspectionPmDueAtIso(input: {
  inspectionDate?: string | null
  nowMs?: number
}): string {
  const insp = input.inspectionDate?.trim()
  if (insp && /^\d{4}-\d{2}-\d{2}/.test(insp)) {
    return new Date(`${insp.slice(0, 10)}T20:00:00.000Z`).toISOString()
  }
  const now = input.nowMs ?? Date.now()
  return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
}

export type StandaloneInspectionPmTaskPlan = {
  title: string
  taskKind: 'inspection'
  dueAtIso: string
  building: string | null
  unitLabel: string | null
  metadata: {
    source: 'tenant_notice' | 'inspection_report'
    inspection_report_id: string
    source_document_id: string | null
    letter_type: string
    is_abated: boolean
    emergency_item_count: number
    standard_item_count: number
  }
}

/**
 * PM Compliance row for a zero-checklist inspection notice.
 * Reuses preventive_maintenance_tasks (same table as HQS re-inspection tasks).
 */
export function planStandaloneInspectionPmComplianceTask(input: {
  inspectionReportId: string
  sourceDocumentId?: string | null
  unitLabel?: string | null
  building?: string | null
  letterType?: string | null
  inspectionDate?: string | null
  nowMs?: number
}): StandaloneInspectionPmTaskPlan {
  const title = standaloneInspectionActiveTaskTitle({
    letterType: input.letterType,
    inspectionDate: input.inspectionDate,
  })
  const letter = String(input.letterType ?? 'tenant_notice').trim() || 'tenant_notice'
  return {
    title: title.slice(0, 200),
    taskKind: 'inspection',
    dueAtIso: standaloneInspectionPmDueAtIso({
      inspectionDate: input.inspectionDate,
      nowMs: input.nowMs,
    }),
    building: input.building?.trim() || null,
    unitLabel: input.unitLabel?.trim() || null,
    metadata: {
      source: letter === 'tenant_notice' ? 'tenant_notice' : 'inspection_report',
      inspection_report_id: input.inspectionReportId,
      source_document_id: input.sourceDocumentId ?? null,
      letter_type: letter,
      is_abated: false,
      emergency_item_count: 0,
      standard_item_count: 0,
    },
  }
}
