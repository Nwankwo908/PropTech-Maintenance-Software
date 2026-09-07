import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { analyzeInspectionPhotoRow } from "./analyzeInspectionPhoto.ts"
import { extractInspectionReport } from "./extractInspectionReport.ts"
import {
  assertInspectionReportMatchesProperty,
  formatExtractedInspectionAddress,
} from "./gateInspectionReportAddress.ts"
import {
  confirmExtractedInspectionItems,
  logInspectionReportIngested,
  persistInspectionDocumentAnalysis,
} from "./persistInspectionDocument.ts"
import type { VisionHintCategory } from "./types.ts"

/** Matches inspection-uploads bucket file_size_limit (25MB). */
export const MAX_INSPECTION_UPLOAD_BYTES = 25 * 1024 * 1024

export function inspectionStorageExt(contentType: string): string {
  if (contentType.includes("png")) return "png"
  if (contentType.includes("webp")) return "webp"
  if (contentType.includes("pdf")) return "pdf"
  return "jpg"
}

export function inspectionBytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export function buildingStorageKey(building: string): string {
  return building.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 80)
}

export type InspectionUploadResult = {
  photo: Record<string, unknown>
  unitAssetId: string | null
  taskIds: string[]
}

export async function processInspectionUpload(input: {
  supabase: SupabaseClient
  landlordId: string
  assessmentId: string
  building: string
  propertyId: string | null
  bytes: Uint8Array
  imageBase64: string
  contentType: string
  fileName: string
  hintCategory: VisionHintCategory | null
  mode: "photo" | "document"
  autoConfirm: boolean
  /** When set, file is already in storage — skip upload and attach this path. */
  existingStoragePath?: string | null
}): Promise<InspectionUploadResult> {
  const extractStarted = Date.now()
  const documentExtract = input.mode === "document"
    ? await extractInspectionReport({
      imageBase64: input.imageBase64,
      contentType: input.contentType,
    })
    : null
  if (documentExtract) {
    await assertInspectionReportMatchesProperty({
      supabase: input.supabase,
      landlordId: input.landlordId,
      building: input.building,
      propertyId: input.propertyId,
      extract: documentExtract,
    })
  }

  const { data: photoRow, error: pErr } = await input.supabase
    .from("property_inspection_photos")
    .insert({
      assessment_id: input.assessmentId,
      landlord_id: input.landlordId,
      file_name: input.fileName,
      content_type: input.contentType,
      hint_category: input.hintCategory,
      status: "queued",
    })
    .select("*")
    .single()
  if (pErr || !photoRow) {
    throw new Error(pErr?.message ?? "Failed to create photo row")
  }

  const photoId = String(photoRow.id)
  const ext = inspectionStorageExt(input.contentType)
  const storagePath = input.existingStoragePath?.trim() ||
    `${input.landlordId}/${buildingStorageKey(input.building)}/${input.assessmentId}/${photoId}.${ext}`

  if (!input.existingStoragePath) {
    const { error: upErr } = await input.supabase.storage
      .from("inspection-uploads")
      .upload(storagePath, input.bytes, { contentType: input.contentType, upsert: true })
    if (upErr) {
      await input.supabase
        .from("property_inspection_photos")
        .update({
          status: "error",
          error_message: `Upload failed: ${upErr.message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", photoId)
      throw new Error(`Upload failed: ${upErr.message}`)
    }
  }

  await input.supabase
    .from("property_inspection_photos")
    .update({ storage_path: storagePath, updated_at: new Date().toISOString() })
    .eq("id", photoId)

  if (documentExtract) {
    const analyzed = await persistInspectionDocumentAnalysis({
      supabase: input.supabase,
      photoId,
      extract: documentExtract,
      provider: "gpt4o",
      latencyMs: Date.now() - extractStarted,
      extras: { _fileSize: input.bytes.length, _fileName: input.fileName },
    })
    let unitAssetId: string | null =
      analyzed.unit_asset_id != null ? String(analyzed.unit_asset_id) : null
    let taskIds: string[] = []
    if (input.autoConfirm) {
      const confirmed = await confirmExtractedInspectionItems({
        supabase: input.supabase,
        landlordId: input.landlordId,
        building: input.building,
        photoId,
        assessmentId: input.assessmentId,
        extract: documentExtract,
        provider: "gpt4o",
        storagePath,
      })
      unitAssetId = confirmed.unitAssetId ?? unitAssetId
      taskIds = confirmed.taskIds
    }
    await logInspectionReportIngested({
      supabase: input.supabase,
      landlordId: input.landlordId,
      building: input.building,
      photoId,
      assessmentId: input.assessmentId,
      fileName: input.fileName,
      extractedAddress: formatExtractedInspectionAddress(documentExtract.propertyAddress),
      itemCount: documentExtract.items.length,
    })
    const { data: latest } = await input.supabase
      .from("property_inspection_photos")
      .select("*")
      .eq("id", photoId)
      .maybeSingle()
    return {
      photo: (latest ?? analyzed) as Record<string, unknown>,
      unitAssetId,
      taskIds,
    }
  }

  const analyzed = await analyzeInspectionPhotoRow(
    input.supabase,
    photoId,
    input.imageBase64,
    input.contentType,
    input.hintCategory,
    input.mode,
    storagePath,
  )
  return {
    photo: analyzed,
    unitAssetId: analyzed.unit_asset_id != null ? String(analyzed.unit_asset_id) : null,
    taskIds: [],
  }
}
