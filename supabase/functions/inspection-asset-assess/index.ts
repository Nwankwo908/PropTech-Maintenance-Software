/**
 * AI appliance / systems inspection assessment.
 *
 * POST JSON:
 *  { action: "create_assessment", landlordId, building }
 *  { action: "upload_and_analyze", landlordId, assessmentId, fileName?, contentType?,
 *    hintCategory?, mode?: "photo"|"document", imageBase64 }
 *  { action: "retry", landlordId, photoId }
 *  { action: "confirm", landlordId, photoId, result: ApplianceVisionResult }
 *  { action: "list_photos", landlordId, assessmentId }
 *  { action: "list_assets", landlordId, building }
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { confirmInspectionAssessment } from "../_shared/vision/confirmAssessment.ts"
import { getVisionProvider, getVisionProviderName } from "../_shared/vision/getProvider.ts"
import {
  mergeHintCategory,
  preclassifyWithRoboflow,
  type RoboflowPreclassifyResult,
} from "../_shared/vision/roboflowPreclassify.ts"
import { normalizeApplianceVisionResult } from "../_shared/vision/normalize.ts"
import type { VisionHintCategory } from "../_shared/vision/types.ts"
import { resolveOperationsGraphScope } from "../_shared/graph/operationsGraph.ts"

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

function buildingKey(building: string): string {
  return building.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 80)
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
    unitAssetId: row.unit_asset_id != null ? String(row.unit_asset_id) : null,
  }
}

async function analyzePhotoRow(
  supabase: ReturnType<typeof createClient>,
  photoId: string,
  imageBase64: string,
  contentType: string,
  hintCategory: string | null,
  mode: "photo" | "document",
): Promise<Record<string, unknown>> {
  const started = Date.now()
  await supabase
    .from("property_inspection_photos")
    .update({ status: "analyzing", error_message: null, updated_at: new Date().toISOString() })
    .eq("id", photoId)

  try {
    const provider = getVisionProvider()
    const providerName = provider.name

    // Optional Roboflow pre-pass (photo mode). Never blocks LLM analysis.
    let roboflow: RoboflowPreclassifyResult | null = null
    if (mode === "photo") {
      roboflow = await preclassifyWithRoboflow(imageBase64)
    }
    const effectiveHint = mergeHintCategory(hintCategory, roboflow)

    if (mode === "document" && provider.analyzeDocument) {
      const items = await provider.analyzeDocument(imageBase64, contentType)
      const primary = items[0] ?? normalizeApplianceVisionResult({
        category: "unknown",
        identifiedItem: { type: "Inspection report findings" },
        estimatedAge: { value: null, confidence: "low", basis: "No items extracted" },
        condition: { rating: "fair", summary: "No discrete assets extracted from document." },
        deficiencies: [],
        maintenanceRecommendations: [],
        rawConfidenceNotes: "Document extract returned no items.",
      })
      // Store full list under ai_result.items for multi-item review
      const packed = {
        ...primary,
        rawConfidenceNotes: [
          primary.rawConfidenceNotes,
          items.length > 1 ? `${items.length} items extracted; confirming the primary finding first.` : null,
        ]
          .filter(Boolean)
          .join(" "),
        _extractedItems: items,
      }
      const latencyMs = Date.now() - started
      const { data, error } = await supabase
        .from("property_inspection_photos")
        .update({
          status: "needs_review",
          ai_result: packed,
          provider: providerName,
          latency_ms: latencyMs,
          estimated_cost_usd: 0.01,
          updated_at: new Date().toISOString(),
        })
        .eq("id", photoId)
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return data as Record<string, unknown>
    }

    const result = await provider.analyzeImage(
      imageBase64,
      effectiveHint ?? undefined,
      contentType,
    )
    const enriched = {
      ...result,
      rawConfidenceNotes: [result.rawConfidenceNotes, roboflow?.note]
        .filter(Boolean)
        .join(" "),
      ...(roboflow
        ? {
          _roboflow: {
            modelId: roboflow.modelId,
            hintCategory: roboflow.hintCategory,
            confidence: roboflow.confidence,
            topClass: roboflow.topClass,
            predictions: roboflow.predictions.slice(0, 8),
            latencyMs: roboflow.latencyMs,
            userHint: hintCategory,
            effectiveHint,
          },
        }
        : {}),
    }
    const latencyMs = Date.now() - started
    const { data, error } = await supabase
      .from("property_inspection_photos")
      .update({
        status: "needs_review",
        ai_result: enriched,
        // Persist resolved hint when Roboflow filled a gap (keeps retry consistent)
        ...(effectiveHint && !hintCategory ? { hint_category: effectiveHint } : {}),
        provider: providerName,
        latency_ms: latencyMs,
        estimated_cost_usd: 0.008,
        updated_at: new Date().toISOString(),
      })
      .eq("id", photoId)
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    return data as Record<string, unknown>
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vision analysis failed"
    console.error("[inspection-asset-assess] analyze", photoId, message)
    const { data } = await supabase
      .from("property_inspection_photos")
      .update({
        status: "error",
        error_message: message.slice(0, 500),
        provider: getVisionProviderName(),
        latency_ms: Date.now() - started,
        updated_at: new Date().toISOString(),
      })
      .eq("id", photoId)
      .select("*")
      .single()
    return (data as Record<string, unknown>) ?? { id: photoId, status: "error", error_message: message }
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

    if (action === "upload_and_analyze") {
      const assessmentId = asString(body.assessmentId)
      if (!assessmentId || !uuidRe.test(assessmentId)) {
        return jsonResponse({ error: "assessmentId is required" }, 400)
      }
      const imageBase64 = asString(body.imageBase64)
      if (!imageBase64) return jsonResponse({ error: "imageBase64 is required" }, 400)

      const bytes = decodeBase64(imageBase64)
      if (!bytes?.length) return jsonResponse({ error: "Invalid imageBase64" }, 400)
      if (bytes.length > 10 * 1024 * 1024) {
        return jsonResponse({ error: "File must be 10MB or smaller" }, 400)
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

      const hintRaw = asString(body.hintCategory)
      const hintCategory = HINTS.has(hintRaw)
        ? (hintRaw as VisionHintCategory)
        : null
      const contentType = asString(body.contentType) || "image/jpeg"
      const fileName = asString(body.fileName) || "inspection-photo.jpg"
      const mode = asString(body.mode) === "document" ? "document" : "photo"

      const { data: photoRow, error: pErr } = await supabase
        .from("property_inspection_photos")
        .insert({
          assessment_id: assessmentId,
          landlord_id: landlordId,
          file_name: fileName,
          content_type: contentType,
          hint_category: hintCategory,
          status: "queued",
        })
        .select("*")
        .single()
      if (pErr || !photoRow) {
        return jsonResponse({ error: pErr?.message ?? "Failed to create photo row" }, 500)
      }

      const photoId = String(photoRow.id)
      const path =
        `${landlordId}/${buildingKey(String(assessment.building))}/${assessmentId}/${photoId}`
      const ext = contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
          ? "webp"
          : contentType.includes("pdf")
            ? "pdf"
            : "jpg"
      const storagePath = `${path}.${ext}`

      const { error: upErr } = await supabase.storage
        .from("inspection-uploads")
        .upload(storagePath, bytes, { contentType, upsert: true })
      if (upErr) {
        await supabase
          .from("property_inspection_photos")
          .update({
            status: "error",
            error_message: `Upload failed: ${upErr.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", photoId)
        return jsonResponse({ error: `Upload failed: ${upErr.message}` }, 500)
      }

      await supabase
        .from("property_inspection_photos")
        .update({ storage_path: storagePath, updated_at: new Date().toISOString() })
        .eq("id", photoId)

      const analyzed = await analyzePhotoRow(
        supabase,
        photoId,
        imageBase64,
        contentType,
        hintCategory,
        mode,
      )
      return jsonResponse({ photo: mapPhotoRow(analyzed) })
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
      const analyzed = await analyzePhotoRow(
        supabase,
        photoId,
        imageBase64,
        contentType,
        photo.hint_category != null ? String(photo.hint_category) : null,
        mode,
      )
      return jsonResponse({ photo: mapPhotoRow(analyzed) })
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
    const message = err instanceof Error ? err.message : "Unexpected error"
    console.error("[inspection-asset-assess]", action, message)
    return jsonResponse({ error: message }, 500)
  }
})
