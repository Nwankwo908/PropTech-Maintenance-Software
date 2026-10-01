/**
 * Load confirmed HQS / compliance inspection letters for Property Intelligence.
 */
import { supabase } from '@/lib/supabase'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  planHqsPmComplianceTask,
  unitBuildingMatchesPropertyLabel,
} from '@shared/maintenance/hqsPropertySurfaces'

export type PropertyHqsInspectionReportRow = {
  id: string
  unitLabel: string | null
  letterType: string
  isAbated: boolean
  inspectionDate: string | null
  reinspectionDate: string | null
  emergencyItemCount: number
  standardItemCount: number
  status: string
  sourceDocumentId: string | null
  createdAt: string
  /** Original SMS/dashboard file name when source document exists. */
  fileName: string | null
  storageBucket: string | null
  storagePath: string | null
  contentType: string | null
  sourceChannel: string | null
  /** Signed URL for Documents list (best-effort). */
  signedUrl: string | null
}

export type PropertyHqsDocumentRow = {
  id: string
  fileName: string
  fileSize: number
  uploadedAt: string
  status: 'ready'
  source: 'hqs_sms' | 'hqs_email' | 'hqs_dashboard' | 'hqs_other'
  href: string | null
  inspectionReportId: string
  removable: false
}

async function resolveUnitIdsForPropertySurface(input: {
  landlordId: string
  building: string
  propertyId?: string | null
}): Promise<Map<string, string | null>> {
  const unitLabelById = new Map<string, string | null>()

  if (input.propertyId?.trim()) {
    const { data: byProp } = await supabase
      .from('units')
      .select('id, unit_label, building, property_id')
      .eq('landlord_id', input.landlordId)
      .eq('property_id', input.propertyId.trim())
    for (const u of byProp ?? []) {
      unitLabelById.set(String(u.id), (u.unit_label as string | null) ?? null)
    }
  }

  // Also pull landlord units and match flexible building labels
  // (page "646 Bartlett, Baltimore, MD 21218" vs unit "646 Bartlett").
  const { data: allUnits } = await supabase
    .from('units')
    .select('id, unit_label, building, property_id')
    .eq('landlord_id', input.landlordId)
    .limit(500)

  for (const u of allUnits ?? []) {
    const id = String(u.id)
    if (unitLabelById.has(id)) continue
    if (
      input.propertyId?.trim() &&
      String(u.property_id ?? '') === input.propertyId.trim()
    ) {
      unitLabelById.set(id, (u.unit_label as string | null) ?? null)
      continue
    }
    if (unitBuildingMatchesPropertyLabel(String(u.building ?? ''), input.building)) {
      unitLabelById.set(id, (u.unit_label as string | null) ?? null)
    }
  }

  return unitLabelById
}

export async function listHqsInspectionReportsForBuilding(
  building: string,
  options?: { propertyId?: string | null },
): Promise<PropertyHqsInspectionReportRow[]> {
  const landlordId = getActiveLandlordId()
  if (!landlordId || !building.trim()) return []

  const unitLabelById = await resolveUnitIdsForPropertySurface({
    landlordId,
    building,
    propertyId: options?.propertyId,
  })

  const unitIds = [...unitLabelById.keys()]
  if (unitIds.length === 0 && !options?.propertyId?.trim()) return []

  let query = supabase
    .from('inspection_reports')
    .select(
      'id, unit_id, property_id, letter_type, is_abated, inspection_date, reinspection_date, emergency_item_count, standard_item_count, status, source_document_id, created_at',
    )
    .eq('landlord_id', landlordId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (unitIds.length > 0 && options?.propertyId?.trim()) {
    query = query.or(
      `unit_id.in.(${unitIds.join(',')}),property_id.eq.${options.propertyId.trim()}`,
    )
  } else if (unitIds.length > 0) {
    query = query.in('unit_id', unitIds)
  } else if (options?.propertyId?.trim()) {
    query = query.eq('property_id', options.propertyId.trim())
  }

  const { data, error } = await query
  if (error || !data) return []

  const sourceIds = data
    .map((row) =>
      row.source_document_id == null ? null : String(row.source_document_id),
    )
    .filter((id): id is string => Boolean(id))

  const docsById = new Map<
    string,
    {
      file_name: string | null
      storage_bucket: string | null
      storage_path: string | null
      content_type: string | null
      source_channel: string | null
    }
  >()
  if (sourceIds.length > 0) {
    const { data: docs } = await supabase
      .from('inspection_source_documents')
      .select(
        'id, file_name, storage_bucket, storage_path, content_type, source_channel, property_id, unit_id',
      )
      .in('id', sourceIds)
    for (const doc of docs ?? []) {
      docsById.set(String(doc.id), {
        file_name: doc.file_name == null ? null : String(doc.file_name),
        storage_bucket: doc.storage_bucket == null ? null : String(doc.storage_bucket),
        storage_path: doc.storage_path == null ? null : String(doc.storage_path),
        content_type: doc.content_type == null ? null : String(doc.content_type),
        source_channel: doc.source_channel == null ? null : String(doc.source_channel),
      })
    }
  }

  const rows: PropertyHqsInspectionReportRow[] = []
  for (const row of data) {
    const sourceDocumentId =
      row.source_document_id == null ? null : String(row.source_document_id)
    const doc = sourceDocumentId ? docsById.get(sourceDocumentId) : null
    let signedUrl: string | null = null
    const bucket = doc?.storage_bucket?.trim() || 'maintenance-uploads'
    if (doc?.storage_path) {
      try {
        const { data: signed } = await supabase.storage
          .from(bucket)
          .createSignedUrl(doc.storage_path, 3600)
        signedUrl = signed?.signedUrl ?? null
      } catch {
        signedUrl = null
      }
    }

    rows.push({
      id: String(row.id),
      unitLabel: unitLabelById.get(String(row.unit_id)) ?? null,
      letterType: String(row.letter_type ?? 'standard_fail'),
      isAbated: Boolean(row.is_abated),
      inspectionDate: row.inspection_date == null ? null : String(row.inspection_date),
      reinspectionDate:
        row.reinspection_date == null ? null : String(row.reinspection_date),
      emergencyItemCount: Number(row.emergency_item_count ?? 0),
      standardItemCount: Number(row.standard_item_count ?? 0),
      status: String(row.status ?? 'open'),
      sourceDocumentId,
      createdAt: String(row.created_at),
      fileName: doc?.file_name ?? null,
      storageBucket: doc?.storage_bucket ?? null,
      storagePath: doc?.storage_path ?? null,
      contentType: doc?.content_type ?? null,
      sourceChannel: doc?.source_channel ?? null,
      signedUrl,
    })

    // Best-effort: ensure PM compliance task exists for older letters.
    void ensureHqsPmTaskForReport({
      landlordId,
      reportId: String(row.id),
      sourceDocumentId,
      unitLabel: unitLabelById.get(String(row.unit_id)) ?? null,
      building,
      letterType: String(row.letter_type ?? 'standard_fail'),
      isAbated: Boolean(row.is_abated),
      emergencyItemCount: Number(row.emergency_item_count ?? 0),
      standardItemCount: Number(row.standard_item_count ?? 0),
      reinspectionDate:
        row.reinspection_date == null ? null : String(row.reinspection_date),
      inspectionDate: row.inspection_date == null ? null : String(row.inspection_date),
    })
  }

  return rows
}

/** Map HQS letters into Documents list rows (SMS PDF/image). */
export function hqsLettersToDocumentRows(
  letters: PropertyHqsInspectionReportRow[],
): PropertyHqsDocumentRow[] {
  const out: PropertyHqsDocumentRow[] = []
  for (const letter of letters) {
    if (!letter.sourceDocumentId) continue
    const channel = (letter.sourceChannel ?? 'sms').toLowerCase()
    const source: PropertyHqsDocumentRow['source'] =
      channel === 'email'
        ? 'hqs_email'
        : channel === 'dashboard'
          ? 'hqs_dashboard'
          : channel === 'other'
            ? 'hqs_other'
            : 'hqs_sms'
    const unitBit = letter.unitLabel ? `Unit ${letter.unitLabel} · ` : ''
    const fileName =
      letter.fileName?.trim() ||
      `${unitBit}HQS inspection letter`.replace(/^ · /, '')
    out.push({
      id: `hqs-doc-${letter.sourceDocumentId}`,
      fileName,
      fileSize: 0,
      uploadedAt: letter.createdAt,
      status: 'ready',
      source,
      href: letter.signedUrl,
      inspectionReportId: letter.id,
      removable: false,
    })
  }
  return out
}

async function ensureHqsPmTaskForReport(input: {
  landlordId: string
  reportId: string
  sourceDocumentId: string | null
  unitLabel: string | null
  building: string
  letterType: string
  isAbated: boolean
  emergencyItemCount: number
  standardItemCount: number
  reinspectionDate: string | null
  inspectionDate: string | null
}): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('preventive_maintenance_tasks')
      .select('id')
      .eq('landlord_id', input.landlordId)
      .contains('metadata', { inspection_report_id: input.reportId })
      .neq('status', 'cancelled')
      .limit(1)
    if (existing?.length) return

    const plan = planHqsPmComplianceTask({
      inspectionReportId: input.reportId,
      sourceDocumentId: input.sourceDocumentId,
      unitLabel: input.unitLabel,
      building: input.building,
      letterType: input.letterType,
      isAbated: input.isAbated,
      emergencyItemCount: input.emergencyItemCount,
      standardItemCount: input.standardItemCount,
      reinspectionDate: input.reinspectionDate,
      inspectionDate: input.inspectionDate,
    })
    await supabase.from('preventive_maintenance_tasks').insert({
      landlord_id: input.landlordId,
      title: plan.title,
      task_kind: plan.taskKind,
      due_at: plan.dueAtIso,
      status: 'scheduled',
      building: plan.building,
      unit_label: plan.unitLabel,
      metadata: plan.metadata,
    })
  } catch {
    /* best-effort */
  }
}
