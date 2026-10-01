/**
 * Pure gates for HQS letter intake: unit mapping + landlord confirm before writes.
 */
import type { HqsDeficiencyRow, HqsLetterExtraction } from './hqsInspectionLetter.ts'
import {
  ownerResponsibilityDeficiencies,
  resolveHqsDeficiencyDueDateIso,
} from './hqsInspectionLetter.ts'
import { mapHqsFailCategoryToVendorTrade } from './hqsFailCategoryTrade.ts'

export type HqsUnitMapping = {
  landlordId: string
  ownerIdExternal: string
  tenantIdExternal: string
  unitId: string
  propertyId?: string | null
}

export type HqsIntakePendingState = {
  awaiting_hqs_unit?: boolean
  awaiting_hqs_confirm?: boolean
  hqs_extraction?: HqsLetterExtraction
  hqs_source_document_id?: string | null
  hqs_unit_id?: string | null
  hqs_property_id?: string | null
  hqs_media_kind?: 'pdf' | 'image' | 'unknown'
}

export function lookupHqsUnitMapping(
  maps: readonly HqsUnitMapping[],
  input: {
    landlordId: string
    ownerIdExternal: string | null
    tenantIdExternal: string | null
  },
): HqsUnitMapping | null {
  const owner = input.ownerIdExternal?.trim()
  const tenant = input.tenantIdExternal?.trim()
  if (!owner || !tenant) return null
  return (
    maps.find(
      (m) =>
        m.landlordId === input.landlordId &&
        m.ownerIdExternal === owner &&
        m.tenantIdExternal === tenant,
    ) ?? null
  )
}

/** No inspection_reports / work orders until unit is known. */
export function canCreateHqsInspectionRecords(input: {
  unitId: string | null | undefined
  landlordConfirmed: boolean
}): boolean {
  return Boolean(input.unitId?.trim()) && input.landlordConfirmed === true
}

export type PlannedHqsWorkOrder = {
  description: string
  issueCategory: string
  urgency: 'urgent' | 'normal'
  priority: 'urgent' | 'normal'
  dueAtIsoDate: string | null
  section: 'emergency' | 'standard'
  failItemCategory: string
  roomOrArea: string | null
}

export function planHqsWorkOrdersFromExtraction(
  extraction: HqsLetterExtraction,
  opts?: { tradeOverlay?: Record<string, string> | null; todayIso?: string },
): PlannedHqsWorkOrder[] {
  const ownerRows = ownerResponsibilityDeficiencies(extraction)
  return ownerRows.map((row) => planOne(extraction, row, opts))
}

function planOne(
  extraction: HqsLetterExtraction,
  row: HqsDeficiencyRow,
  opts?: { tradeOverlay?: Record<string, string> | null; todayIso?: string },
): PlannedHqsWorkOrder {
  const trade = mapHqsFailCategoryToVendorTrade(row.failItemCategory, opts?.tradeOverlay)
  const emergency = row.section === 'emergency'
  const parts = [
    `HQS fail: ${row.failItemCategory}`,
    row.roomOrArea ? `Area: ${row.roomOrArea}` : null,
    row.notes,
    extraction.inspectionIdExternal
      ? `Inspection ${extraction.inspectionIdExternal}`
      : null,
  ].filter(Boolean)
  return {
    description: parts.join('\n'),
    issueCategory: trade,
    urgency: emergency ? 'urgent' : 'normal',
    priority: emergency ? 'urgent' : 'normal',
    dueAtIsoDate: resolveHqsDeficiencyDueDateIso(extraction, row, opts?.todayIso),
    section: row.section,
    failItemCategory: row.failItemCategory,
    roomOrArea: row.roomOrArea,
  }
}

export function shouldSendHqsAbatementAlert(extraction: HqsLetterExtraction): boolean {
  return extraction.isAbated === true
}
