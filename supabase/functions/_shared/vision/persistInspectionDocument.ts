import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { confirmInspectionAssessment } from "./confirmAssessment.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { resolveOperationsGraphScope } from "../graph/operationsGraph.ts"
import { normalizeApplianceVisionResult, roofCoveringIdentity } from "./normalize.ts"
import { inspectionReportItemEligibleForAutoConfirm } from "./inspectionReportAutoConfirm.ts"
import type { InspectionReportExtract } from "./extractInspectionReport.ts"

export function packInspectionReportAiResult(
  extract: InspectionReportExtract,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const items = extract.items
  const primary = items[0] ?? normalizeApplianceVisionResult({
    category: "unknown",
    identifiedItem: { type: "Inspection report" },
    estimatedAge: { value: null, confidence: "low", basis: "No items extracted" },
    condition: { rating: "fair", summary: "No discrete assets extracted from document." },
    deficiencies: [],
    maintenanceRecommendations: [],
    rawConfidenceNotes: "Document extract returned no items.",
  })
  return {
    ...primary,
    rawConfidenceNotes: [
      primary.rawConfidenceNotes,
      items.length > 1
        ? `${items.length} items extracted from the inspection report.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    _extractedItems: items,
    _source: "inspection_report",
    _propertyAddress: extract.propertyAddress,
    ...extras,
    _needsManualReview: extras?._needsManualReview === true || items.length === 0,
  }
}

export async function persistInspectionDocumentAnalysis(input: {
  supabase: SupabaseClient
  photoId: string
  extract: InspectionReportExtract
  provider: string
  latencyMs: number
  extras?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const packed = packInspectionReportAiResult(input.extract, input.extras)
  const { data, error } = await input.supabase
    .from("property_inspection_photos")
    .update({
      status: "needs_review",
      ai_result: packed,
      provider: input.provider,
      latency_ms: input.latencyMs,
      estimated_cost_usd: 0.01,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.photoId)
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return data as Record<string, unknown>
}

export type ConfirmExtractedInspectionItemsResult = {
  unitAssetId: string | null
  taskIds: string[]
  autoConfirmedCount: number
  skippedCount: number
  needsManualReview: boolean
}

async function markInspectionDocumentNeedsReview(input: {
  supabase: SupabaseClient
  photoId: string
  extract: InspectionReportExtract
  extras?: Record<string, unknown>
}): Promise<void> {
  const { data: existing } = await input.supabase
    .from("property_inspection_photos")
    .select("ai_result")
    .eq("id", input.photoId)
    .maybeSingle()
  const prev =
    existing?.ai_result && typeof existing.ai_result === "object"
      ? (existing.ai_result as Record<string, unknown>)
      : {}
  const packed = packInspectionReportAiResult(input.extract, {
    _fileSize: prev._fileSize,
    _fileName: prev._fileName,
    ...input.extras,
    _needsManualReview: true,
  })
  await input.supabase
    .from("property_inspection_photos")
    .update({
      status: "needs_review",
      ai_result: packed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.photoId)
}

export async function confirmExtractedInspectionItems(input: {
  supabase: SupabaseClient
  landlordId: string
  building: string
  photoId: string
  assessmentId: string
  extract: InspectionReportExtract
  provider: string | null
  storagePath: string | null
}): Promise<ConfirmExtractedInspectionItemsResult> {
  const items = input.extract.items
  const eligible = items.filter(inspectionReportItemEligibleForAutoConfirm)
  const skippedCount = items.length - eligible.length
  const needsManualReview = eligible.length === 0

  if (eligible.length === 0) {
    await markInspectionDocumentNeedsReview({
      supabase: input.supabase,
      photoId: input.photoId,
      extract: input.extract,
      extras: {
        _autoConfirmedCount: 0,
        _skippedCount: items.length,
      },
    })
    return {
      unitAssetId: null,
      taskIds: [],
      autoConfirmedCount: 0,
      skippedCount: items.length,
      needsManualReview: true,
    }
  }

  let unitAssetId: string | null = null
  const taskIds: string[] = []
  const confirmedAssetIds: string[] = []
  let autoConfirmedCount = 0
  for (const item of eligible) {
    try {
      const confirmed = await confirmInspectionAssessment({
        supabase: input.supabase,
        landlordId: input.landlordId,
        building: input.building,
        photoId: input.photoId,
        assessmentId: input.assessmentId,
        result: item,
        provider: input.provider,
        storagePath: input.storagePath,
        distinctFindingsPerPhoto: true,
      })
      autoConfirmedCount += 1
      if (!unitAssetId) unitAssetId = confirmed.unitAssetId
      confirmedAssetIds.push(confirmed.unitAssetId)
      taskIds.push(...confirmed.taskIds)
    } catch (err) {
      console.error(
        "[confirmExtractedInspectionItems] skipped item",
        item.category,
        item.identifiedItem?.type,
        err,
      )
    }
  }

  await retireDuplicateRoofCoveringTasks({
    supabase: input.supabase,
    landlordId: input.landlordId,
    building: input.building,
    keepAssetIds: confirmedAssetIds,
  })

  return {
    unitAssetId,
    taskIds,
    autoConfirmedCount,
    skippedCount: skippedCount + (eligible.length - autoConfirmedCount),
    needsManualReview: autoConfirmedCount === 0,
  }
}

async function retireDuplicateRoofCoveringTasks(input: {
  supabase: SupabaseClient
  landlordId: string
  building: string
  keepAssetIds: string[]
}): Promise<void> {
  if (input.keepAssetIds.length === 0) return
  const { data: assets } = await input.supabase
    .from("unit_assets")
    .select("id, appliance_type, metadata")
    .eq("landlord_id", input.landlordId)
    .eq("building", input.building)
  const roofs = (assets ?? []).filter((row) => {
    const meta = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {}
    const slot = String(meta.slotKey ?? meta.registryAssetType ?? "")
    return slot === "roof" || String(row.appliance_type ?? "").toLowerCase().includes("roof")
  })
  if (roofs.length <= 2) return
  const keep = new Set(input.keepAssetIds)
  const keptCovers = new Set(
    roofs
      .filter((row) => keep.has(String(row.id)))
      .map((row) => roofCoveringIdentity(String(row.appliance_type ?? ""))),
  )
  if (keptCovers.size === 0) return
  const extraIds = roofs
    .filter((row) => {
      const id = String(row.id)
      if (keep.has(id)) return false
      return keptCovers.has(roofCoveringIdentity(String(row.appliance_type ?? "")))
    })
    .map((row) => String(row.id))
  if (extraIds.length === 0) return
  await input.supabase
    .from("preventive_maintenance_tasks")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("landlord_id", input.landlordId)
    .in("unit_asset_id", extraIds)
    .neq("status", "completed")
}

export async function logInspectionReportIngested(input: {
  supabase: SupabaseClient
  landlordId: string
  building: string
  photoId: string
  assessmentId: string
  fileName: string
  extractedAddress: string
  itemCount: number
  needsManualReview?: boolean
}): Promise<void> {
  const scope = await resolveOperationsGraphScope(input.supabase, {
    landlordId: input.landlordId,
    building: input.building,
  })
  const needsReview = input.needsManualReview === true
  const message = needsReview
    ? input.itemCount > 0
      ? `Inspection report uploaded. ${input.itemCount} finding${input.itemCount === 1 ? "" : "s"} added to preventive maintenance; remaining findings need review.`
      : "Inspection report uploaded and needs review before findings appear in preventive maintenance."
    : input.itemCount > 0
      ? `Inspection report saved and ${input.itemCount} finding${input.itemCount === 1 ? "" : "s"} added to preventive maintenance.`
      : "Inspection report saved to this property."
  await recordActivityLog(input.supabase, {
    landlordId: input.landlordId,
    eventType: "inspection.report_ingested",
    source: "dashboard",
    actorType: "landlord",
    propertyId: scope.propertyId,
    unitId: scope.unitId,
    metadata: {
      message,
      building: input.building,
      photo_id: input.photoId,
      assessment_id: input.assessmentId,
      file_name: input.fileName,
      extracted_address: input.extractedAddress,
      item_count: input.itemCount,
      needs_review: needsReview,
    },
  })
}
