import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { confirmInspectionAssessment } from "./confirmAssessment.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { resolveOperationsGraphScope } from "../graph/operationsGraph.ts"
import { normalizeApplianceVisionResult } from "./normalize.ts"
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

export async function confirmExtractedInspectionItems(input: {
  supabase: SupabaseClient
  landlordId: string
  building: string
  photoId: string
  assessmentId: string
  extract: InspectionReportExtract
  provider: string | null
  storagePath: string | null
}): Promise<{ unitAssetId: string | null; taskIds: string[] }> {
  const items = input.extract.items.filter((item) => item.identifiedItem.type.trim().length > 0)
  if (items.length === 0) {
    return { unitAssetId: null, taskIds: [] }
  }

  let unitAssetId: string | null = null
  const taskIds: string[] = []
  for (const item of items) {
    const confirmed = await confirmInspectionAssessment({
      supabase: input.supabase,
      landlordId: input.landlordId,
      building: input.building,
      photoId: input.photoId,
      assessmentId: input.assessmentId,
      result: item,
      provider: input.provider,
      storagePath: input.storagePath,
    })
    if (!unitAssetId) unitAssetId = confirmed.unitAssetId
    taskIds.push(...confirmed.taskIds)
  }
  return { unitAssetId, taskIds }
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
}): Promise<void> {
  const scope = await resolveOperationsGraphScope(input.supabase, {
    landlordId: input.landlordId,
    building: input.building,
  })
  await recordActivityLog(input.supabase, {
    landlordId: input.landlordId,
    eventType: "inspection.report_ingested",
    source: "dashboard",
    actorType: "landlord",
    propertyId: scope.propertyId,
    unitId: scope.unitId,
    metadata: {
      message: input.itemCount > 0
        ? `Inspection report saved and ${input.itemCount} finding${input.itemCount === 1 ? "" : "s"} added to preventive maintenance.`
        : "Inspection report saved to this property.",
      building: input.building,
      photo_id: input.photoId,
      assessment_id: input.assessmentId,
      file_name: input.fileName,
      extracted_address: input.extractedAddress,
      item_count: input.itemCount,
    },
  })
}
