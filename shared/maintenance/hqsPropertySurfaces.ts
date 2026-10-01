/**
 * Downstream surfaces for a confirmed HQS letter:
 * Property Intelligence Documents, PM Compliance, Home Data Graph ingest audit.
 */

export type HqsPmTaskPlan = {
  title: string
  taskKind: 'inspection'
  dueAtIso: string
  building: string | null
  unitLabel: string | null
  metadata: {
    source: 'hqs_letter'
    inspection_report_id: string
    source_document_id: string | null
    letter_type: string
    is_abated: boolean
    emergency_item_count: number
    standard_item_count: number
  }
}

export type HqsHomeDataIngestPlan = {
  provider: 'manual'
  providerRecordId: string
  raw: Record<string, unknown>
}

/** Prefer reinspection date, else inspection date + 30 days, else now + 30 days. */
export function hqsPmDueAtIso(input: {
  reinspectionDate?: string | null
  inspectionDate?: string | null
  nowMs?: number
}): string {
  const re = input.reinspectionDate?.trim()
  if (re && /^\d{4}-\d{2}-\d{2}/.test(re)) {
    return new Date(`${re.slice(0, 10)}T17:00:00.000Z`).toISOString()
  }
  const insp = input.inspectionDate?.trim()
  if (insp && /^\d{4}-\d{2}-\d{2}/.test(insp)) {
    const base = Date.parse(`${insp.slice(0, 10)}T17:00:00.000Z`)
    if (Number.isFinite(base)) {
      return new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  }
  const now = input.nowMs ?? Date.now()
  return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
}

export function planHqsPmComplianceTask(input: {
  inspectionReportId: string
  sourceDocumentId?: string | null
  unitLabel?: string | null
  building?: string | null
  letterType?: string | null
  isAbated?: boolean
  emergencyItemCount?: number
  standardItemCount?: number
  reinspectionDate?: string | null
  inspectionDate?: string | null
  nowMs?: number
}): HqsPmTaskPlan {
  const unit = input.unitLabel?.trim()
  const title = unit
    ? `HQS compliance re-inspection — Unit ${unit}`
    : 'HQS compliance re-inspection'
  return {
    title: title.slice(0, 200),
    taskKind: 'inspection',
    dueAtIso: hqsPmDueAtIso({
      reinspectionDate: input.reinspectionDate,
      inspectionDate: input.inspectionDate,
      nowMs: input.nowMs,
    }),
    building: input.building?.trim() || null,
    unitLabel: unit || null,
    metadata: {
      source: 'hqs_letter',
      inspection_report_id: input.inspectionReportId,
      source_document_id: input.sourceDocumentId ?? null,
      letter_type: input.letterType?.trim() || 'standard_fail',
      is_abated: input.isAbated === true,
      emergency_item_count: Number(input.emergencyItemCount ?? 0),
      standard_item_count: Number(input.standardItemCount ?? 0),
    },
  }
}

export function planHqsHomeDataGraphIngest(input: {
  inspectionReportId: string
  sourceDocumentId?: string | null
  unitId?: string | null
  unitLabel?: string | null
  letterType?: string | null
  isAbated?: boolean
  emergencyItemCount?: number
  standardItemCount?: number
  fileName?: string | null
  storagePath?: string | null
}): HqsHomeDataIngestPlan {
  return {
    provider: 'manual',
    providerRecordId: `hqs-letter:${input.inspectionReportId}`,
    raw: {
      kind: 'hqs_inspection_letter',
      inspection_report_id: input.inspectionReportId,
      source_document_id: input.sourceDocumentId ?? null,
      unit_id: input.unitId ?? null,
      unit_label: input.unitLabel ?? null,
      letter_type: input.letterType ?? 'standard_fail',
      is_abated: input.isAbated === true,
      emergency_item_count: Number(input.emergencyItemCount ?? 0),
      standard_item_count: Number(input.standardItemCount ?? 0),
      file_name: input.fileName ?? null,
      storage_path: input.storagePath ?? null,
    },
  }
}

/**
 * Match property page building label to unit.building rows.
 * Exact ilike fails when page is "646 Bartlett, Baltimore, MD 21218"
 * and unit is "646 Bartlett".
 */
export function unitBuildingMatchesPropertyLabel(
  unitBuilding: string | null | undefined,
  propertyLabel: string | null | undefined,
): boolean {
  const a = (unitBuilding ?? '').trim()
  const b = (propertyLabel ?? '').trim()
  if (!a || !b) return false
  if (a.toLowerCase() === b.toLowerCase()) return true

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\bstreets?\b/g, 'st')
      .replace(/\bavenues?\b/g, 'ave')
      .replace(/\broads?\b/g, 'rd')
      .replace(/\bdrives?\b/g, 'dr')
      .replace(/\s+/g, ' ')
      .trim()

  const aKey = normalize(a)
  const bKey = normalize(b)
  if (!aKey || !bKey) return false
  if (aKey === bKey) return true

  const aNum = aKey.match(/^(\d+[a-z]?)\b/)?.[1]
  const bNum = bKey.match(/^(\d+[a-z]?)\b/)?.[1]
  if (aNum && bNum && aNum !== bNum) return false

  const shorter = aKey.length <= bKey.length ? aKey : bKey
  const longer = aKey.length <= bKey.length ? bKey : aKey
  if (longer.startsWith(`${shorter} `) || longer.startsWith(`${shorter} (`)) {
    return true
  }
  return shorter.length >= 8 && longer.includes(` ${shorter} `)
}
