/**
 * AI appliance / systems inspection assessment.
 *
 * POST JSON:
 *  { action: "create_assessment", landlordId, building }
 *  { action: "upload_and_analyze", landlordId, assessmentId, fileName?, contentType?,
 *    hintCategory?, mode?: "photo"|"document", autoConfirm?, imageBase64 }
 *  { action: "create_upload_url", landlordId, assessmentId, fileName?, contentType? }
 *  { action: "ingest_stored", landlordId, assessmentId, storagePath, fileName?, contentType?,
 *    hintCategory?, mode?: "photo"|"document", autoConfirm? }
 *  { action: "retry", landlordId, photoId }
 *  { action: "remove_photo", landlordId, photoId }
 *  { action: "confirm", landlordId, photoId, result: ApplianceVisionResult }
 *  { action: "list_photos", landlordId, assessmentId }
 *  { action: "list_assets", landlordId, building }
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { confirmInspectionAssessment } from "../_shared/vision/confirmAssessment.ts"
import { analyzeInspectionPhotoRow } from "../_shared/vision/analyzeInspectionPhoto.ts"
import { InspectionAddressGateError } from "../_shared/vision/gateInspectionReportAddress.ts"
import {
  MAX_INSPECTION_UPLOAD_BYTES,
  buildingStorageKey,
  inspectionBytesToBase64,
  inspectionStorageExt,
  processInspectionUpload,
} from "../_shared/vision/ingestInspectionUpload.ts"
import { normalizeApplianceVisionResult } from "../_shared/vision/normalize.ts"
import type { VisionHintCategory } from "../_shared/vision/types.ts"
import { resolveOperationsGraphScope } from "../_shared/graph/operationsGraph.ts"
import { recordActivityLog } from "../_shared/graph/recordActivityLog.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const HINTS = new Set(["appliance", "hvac", "water_heater", "boiler", "roof", "other"])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function decodeBase64(raw: string): Uint8Array | null {
  try {
    const cleaned = raw.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "")
    const bin = atob(cleaned)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function mapPhotoRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    assessmentId: String(row.assessment_id),
    storagePath: row.storage_path != null ? String(row.storage_path) : null,
    hintCategory: row.hint_category != null ? String(row.hint_category) : null,
    status: String(row.status),
    aiResult: row.ai_result ?? null,
    confirmedResult: row.confirmed_result ?? null,
    provider: row.provider != null ? String(row.provider) : null,
    errorMessage: row.error_message != null ? String(row.error_message) : null,
    latencyMs: typeof row.latency_ms === "number" ? row.latency_ms : null,
    fileName: row.file_name != null ? String(row.file_name) : null,
    contentType: row.content_type != null ? String(row.content_type) : null,
    createdAt: row.created_at != null ? String(row.created_at) : null,
    unitAssetId: row.unit_asset_id != null ? String(row.unit_asset_id) : null,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const action = asString(body.action)
  const landlordId = asString(body.landlordId)
  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "landlordId is required" }, 400)
  }

  try {
    if (action === "create_assessment") {
      const building = asString(body.building)
      if (!building) return jsonResponse({ error: "building is required" }, 400)

      const scope = await resolveOperationsGraphScope(supabase, { landlordId, building })
      const { data, error } = await supabase
        .from("property_inspection_assessments")
        .insert({
          landlord_id: landlordId,
          building,
          property_id: scope.propertyId,
          status: "open",
        })
        .select("id, landlord_id, building, property_id, status, created_at")
        .single()
      if (error) return jsonResponse({ error: error.message }, 500)
      return jsonResponse({ assessment: data })
    }

    if (action === "list_photos") {
      const assessmentId = asString(body.assessmentId)
      if (!assessmentId || !uuidRe.test(assessmentId)) {
        return jsonResponse({ error: "assessmentId is required" }, 400)
      }
      const { data, error } = await supabase
        .from("property_inspection_photos")
        .select("*")
        .eq("assessment_id", assessmentId)
        .eq("landlord_id", landlordId)
        .order("created_at", { ascending: true })
      if (error) return jsonResponse({ error: error.message }, 500)
      return jsonResponse({
        photos: (data ?? []).map((row) => mapPhotoRow(row as Record<string, unknown>)),
      })
    }

    if (action === "list_assets") {
      const building = asString(body.building)
      if (!building) return jsonResponse({ error: "building is required" }, 400)
      const { data, error } = await supabase
        .from("unit_assets")
        .select(
          "id, appliance_type, appliance_label, brand, model, estimated_age_years, replacement_urgency, failure_risk_pct, detection_source, last_detected_at, metadata",
        )
        .eq("landlord_id", landlordId)
        .eq("building", building)
        .order("updated_at", { ascending: false })
        .limit(50)
      if (error) return jsonResponse({ error: error.message }, 500)
      return jsonResponse({ assets: data ?? [] })
    }

    if (action === "create_upload_url") {
      const assessmentId = asString(body.assessmentId)
      if (!assessmentId || !uuidRe.test(assessmentId)) {
        return jsonResponse({ error: "assessmentId is required" }, 400)
      }
      const { data: assessment, error: aErr } = await supabase
        .from("property_inspection_assessments")
        .select("id, building")
        .eq("id", assessmentId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (aErr || !assessment) {
        return jsonResponse({ error: "Assessment not found" }, 404)
      }
      const { count } = await supabase
        .from("property_inspection_photos")
        .select("id", { count: "exact", head: true })
        .eq("assessment_id", assessmentId)
      if ((count ?? 0) >= 20) {
        return jsonResponse({ error: "Maximum 20 files per assessment session" }, 400)
      }
      const contentType = asString(body.contentType) || "application/pdf"
      const ext = inspectionStorageExt(contentType)
      const storagePath =
        `${landlordId}/${buildingStorageKey(String(assessment.building))}/${assessmentId}/${crypto.randomUUID()}.${ext}`
      const { data: signed, error: signErr } = await supabase.storage
        .from("inspection-uploads")
        .createSignedUploadUrl(storagePath)
      if (signErr || !signed?.token) {
        return jsonResponse({
          error: signErr?.message ?? "Could not prepare the upload.",
        }, 500)
      }
      return jsonResponse({
        storagePath,
        token: signed.token,
        signedUrl: signed.signedUrl ?? null,
      })
    }

    if (action === "ingest_stored") {
      const assessmentId = asString(body.assessmentId)
      const storagePath = asString(body.storagePath)
      if (!assessmentId || !uuidRe.test(assessmentId)) {
        return jsonResponse({ error: "assessmentId is required" }, 400)
      }
      if (!storagePath.startsWith(`${landlordId}/`)) {
        return jsonResponse({ error: "storagePath is invalid" }, 400)
      }

      const { data: assessment, error: aErr } = await supabase
        .from("property_inspection_assessments")
        .select("id, building, property_id")
        .eq("id", assessmentId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (aErr || !assessment) {
        return jsonResponse({ error: "Assessment not found" }, 404)
      }
      const { count } = await supabase
        .from("property_inspection_photos")
        .select("id", { count: "exact", head: true })
        .eq("assessment_id", assessmentId)
      if ((count ?? 0) >= 20) {
        await supabase.storage.from("inspection-uploads").remove([storagePath])
        return jsonResponse({ error: "Maximum 20 files per assessment session" }, 400)
      }

      const { data: file, error: dlErr } = await supabase.storage
        .from("inspection-uploads")
        .download(storagePath)
      if (dlErr || !file) {
        return jsonResponse({ error: dlErr?.message ?? "Failed to download upload" }, 500)
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!bytes.length) {
        await supabase.storage.from("inspection-uploads").remove([storagePath])
        return jsonResponse({ error: "Uploaded file was empty" }, 400)
      }
      if (bytes.length > MAX_INSPECTION_UPLOAD_BYTES) {
        await supabase.storage.from("inspection-uploads").remove([storagePath])
        return jsonResponse({ error: "Each file must be 25MB or smaller." }, 400)
      }

      const hintRaw = asString(body.hintCategory)
      const hintCategory = HINTS.has(hintRaw)
        ? (hintRaw as VisionHintCategory)
        : null
      const contentType = asString(body.contentType) || file.type || "application/pdf"
      const fileName = asString(body.fileName) || "inspection-report.pdf"
      const mode = asString(body.mode) === "document" ? "document" : "photo"
      const imageBase64 = inspectionBytesToBase64(bytes)

      try {
        const ingested = await processInspectionUpload({
          supabase,
          landlordId,
          assessmentId,
          building: String(assessment.building),
          propertyId: assessment.property_id != null ? String(assessment.property_id) : null,
          bytes,
          imageBase64,
          contentType,
          fileName,
          hintCategory,
          mode,
          autoConfirm: body.autoConfirm === true,
          existingStoragePath: storagePath,
        })
        return jsonResponse({
          photo: mapPhotoRow(ingested.photo),
          unitAssetId: ingested.unitAssetId,
          taskIds: ingested.taskIds,
        })
      } catch (err) {
        await supabase.storage.from("inspection-uploads").remove([storagePath])
        throw err
      }
    }

    if (action === "upload_and_analyze") {
      const assessmentId = asString(body.assessmentId)
      if (!assessmentId || !uuidRe.test(assessmentId)) {
        return jsonResponse({ error: "assessmentId is required" }, 400)
      }
      const imageBase64 = asString(body.imageBase64)
      if (!imageBase64) return jsonResponse({ error: "imageBase64 is required" }, 400)

      const bytes = decodeBase64(imageBase64)
      if (!bytes?.length) return jsonResponse({ error: "Invalid imageBase64" }, 400)
      if (bytes.length > MAX_INSPECTION_UPLOAD_BYTES) {
        return jsonResponse({ error: "Each file must be 25MB or smaller." }, 400)
      }

      const { data: assessment, error: aErr } = await supabase
        .from("property_inspection_assessments")
        .select("id, building, property_id")
        .eq("id", assessmentId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (aErr || !assessment) {
        return jsonResponse({ error: "Assessment not found" }, 404)
      }

      const { count } = await supabase
        .from("property_inspection_photos")
        .select("id", { count: "exact", head: true })
        .eq("assessment_id", assessmentId)
      if ((count ?? 0) >= 20) {
        return jsonResponse({ error: "Maximum 20 files per assessment session" }, 400)
      }

      const hintRaw = asString(body.hintCategory)
      const hintCategory = HINTS.has(hintRaw)
        ? (hintRaw as VisionHintCategory)
        : null
      const contentType = asString(body.contentType) || "image/jpeg"
      const fileName = asString(body.fileName) || "inspection-photo.jpg"
      const mode = asString(body.mode) === "document" ? "document" : "photo"
      const ingested = await processInspectionUpload({
        supabase,
        landlordId,
        assessmentId,
        building: String(assessment.building),
        propertyId: assessment.property_id != null ? String(assessment.property_id) : null,
        bytes,
        imageBase64,
        contentType,
        fileName,
        hintCategory,
        mode,
        autoConfirm: body.autoConfirm === true,
      })
      return jsonResponse({
        photo: mapPhotoRow(ingested.photo),
        unitAssetId: ingested.unitAssetId,
        taskIds: ingested.taskIds,
      })
    }

    if (action === "retry") {
      const photoId = asString(body.photoId)
      if (!photoId || !uuidRe.test(photoId)) {
        return jsonResponse({ error: "photoId is required" }, 400)
      }
      const { data: photo, error } = await supabase
        .from("property_inspection_photos")
        .select("*")
        .eq("id", photoId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (error || !photo) return jsonResponse({ error: "Photo not found" }, 404)
      if (!photo.storage_path) {
        return jsonResponse({ error: "Photo has no stored file to retry" }, 400)
      }

      const { data: file, error: dlErr } = await supabase.storage
        .from("inspection-uploads")
        .download(String(photo.storage_path))
      if (dlErr || !file) {
        return jsonResponse({ error: dlErr?.message ?? "Failed to download photo" }, 500)
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      let binary = ""
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!)
      const imageBase64 = btoa(binary)
      const contentType = asString(photo.content_type) || "image/jpeg"
      const mode = contentType.includes("pdf") ? "document" : "photo"
      const analyzed = await analyzeInspectionPhotoRow(
        supabase,
        photoId,
        imageBase64,
        contentType,
        photo.hint_category != null ? String(photo.hint_category) : null,
        mode,
        String(photo.storage_path),
      )
      return jsonResponse({ photo: mapPhotoRow(analyzed) })
    }

    if (action === "remove_photo") {
      const photoId = asString(body.photoId)
      if (!photoId || !uuidRe.test(photoId)) {
        return jsonResponse({ error: "photoId is required" }, 400)
      }
      const { data: photo, error } = await supabase
        .from("property_inspection_photos")
        .select("id, landlord_id, storage_path, file_name, assessment_id, unit_asset_id")
        .eq("id", photoId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (error || !photo) return jsonResponse({ error: "Photo not found" }, 404)

      const storagePath = photo.storage_path != null ? String(photo.storage_path) : ""
      if (storagePath) {
        await supabase.storage.from("inspection-uploads").remove([storagePath])
      }
      await supabase
        .from("inspection_capture_photos")
        .delete()
        .eq("inspection_photo_id", photoId)
        .eq("landlord_id", landlordId)

      const unitAssetId = photo.unit_asset_id != null ? String(photo.unit_asset_id) : ""
      if (unitAssetId) {
        await supabase
          .from("preventive_maintenance_tasks")
          .delete()
          .eq("unit_asset_id", unitAssetId)
          .eq("landlord_id", landlordId)
        await supabase
          .from("unit_assets")
          .delete()
          .eq("id", unitAssetId)
          .eq("landlord_id", landlordId)
      }

      const { error: delErr } = await supabase
        .from("property_inspection_photos")
        .delete()
        .eq("id", photoId)
        .eq("landlord_id", landlordId)
      if (delErr) return jsonResponse({ error: delErr.message }, 500)

      const { data: assessment } = photo.assessment_id
        ? await supabase
          .from("property_inspection_assessments")
          .select("property_id")
          .eq("id", String(photo.assessment_id))
          .maybeSingle()
        : { data: null }

      await recordActivityLog(supabase, {
        landlordId,
        eventType: "inspection.photo_removed",
        source: "dashboard",
        actorType: "landlord",
        propertyId: assessment?.property_id != null ? String(assessment.property_id) : null,
        metadata: {
          message: "An inspection photo was removed.",
          photoId,
          fileName: photo.file_name != null ? String(photo.file_name) : null,
        },
      })
      return jsonResponse({ ok: true })
    }

    if (action === "remove_asset") {
      const assetId = asString(body.assetId)
      if (!assetId || !uuidRe.test(assetId)) {
        return jsonResponse({ error: "assetId is required" }, 400)
      }
      const { data: asset, error } = await supabase
        .from("unit_assets")
        .select("id, building")
        .eq("id", assetId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (error || !asset) return jsonResponse({ error: "Asset not found" }, 404)

      const { data: linkedPhotos } = await supabase
        .from("property_inspection_photos")
        .select("id, storage_path")
        .eq("landlord_id", landlordId)
        .eq("unit_asset_id", assetId)

      for (const linked of linkedPhotos ?? []) {
        const path = linked.storage_path != null ? String(linked.storage_path) : ""
        if (path) {
          await supabase.storage.from("inspection-uploads").remove([path])
        }
        await supabase
          .from("inspection_capture_photos")
          .delete()
          .eq("inspection_photo_id", String(linked.id))
          .eq("landlord_id", landlordId)
        await supabase
          .from("property_inspection_photos")
          .delete()
          .eq("id", String(linked.id))
          .eq("landlord_id", landlordId)
      }

      await supabase
        .from("preventive_maintenance_tasks")
        .delete()
        .eq("unit_asset_id", assetId)
        .eq("landlord_id", landlordId)
      const { error: assetErr } = await supabase
        .from("unit_assets")
        .delete()
        .eq("id", assetId)
        .eq("landlord_id", landlordId)
      if (assetErr) return jsonResponse({ error: assetErr.message }, 500)

      await recordActivityLog(supabase, {
        landlordId,
        eventType: "inspection.asset_removed",
        source: "dashboard",
        actorType: "landlord",
        metadata: {
          message: "An inspection asset was removed.",
          unit_asset_id: assetId,
          building: asset.building != null ? String(asset.building) : null,
        },
      })
      return jsonResponse({ ok: true })
    }

    if (action === "confirm") {
      const photoId = asString(body.photoId)
      if (!photoId || !uuidRe.test(photoId)) {
        return jsonResponse({ error: "photoId is required" }, 400)
      }
      const rawResult = body.result
      if (!rawResult || typeof rawResult !== "object") {
        return jsonResponse({ error: "result is required" }, 400)
      }
      const result = normalizeApplianceVisionResult(rawResult)

      const { data: photo, error } = await supabase
        .from("property_inspection_photos")
        .select("*, property_inspection_assessments(id, building)")
        .eq("id", photoId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (error || !photo) return jsonResponse({ error: "Photo not found" }, 404)

      const joined = photo.property_inspection_assessments as
        | { id: string; building: string }
        | { id: string; building: string }[]
        | null
      const assessment = Array.isArray(joined) ? joined[0] : joined
      if (!assessment?.building) {
        return jsonResponse({ error: "Assessment not found for photo" }, 404)
      }
      const confirmed = await confirmInspectionAssessment({
        supabase,
        landlordId,
        building: assessment.building,
        photoId,
        assessmentId: assessment.id,
        result,
        provider: photo.provider != null ? String(photo.provider) : null,
        storagePath: photo.storage_path != null ? String(photo.storage_path) : null,
      })

      return jsonResponse({
        ok: true,
        unitAssetId: confirmed.unitAssetId,
        taskIds: confirmed.taskIds,
      })
    }

    return jsonResponse({ error: `Unknown action: ${action || "(empty)"}` }, 400)
  } catch (err) {
    if (err instanceof InspectionAddressGateError) {
      return jsonResponse(err.toJSON(), err.httpStatus)
    }
    const message = err instanceof Error ? err.message : "Unexpected error"
    console.error("[inspection-asset-assess]", action, message)
    return jsonResponse({ error: message }, 500)
  }
})
