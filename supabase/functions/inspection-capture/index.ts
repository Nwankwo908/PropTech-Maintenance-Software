/**
 * Phone QR capture for AI Equipment Scan.
 *
 * POST JSON:
 *  { action: "create_session", landlordId, assessmentId }
 *  { action: "complete_session", landlordId, sessionId }
 *  { action: "list_photos", landlordId, sessionId }
 *  { action: "get_session", sessionId, token }
 *  { action: "upload_photo", sessionId, token, imageBase64, contentType?, fileName? }
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../_shared/graph/recordActivityLog.ts"
import { resolveOperationsGraphScope } from "../_shared/graph/operationsGraph.ts"
import { analyzeInspectionPhotoRow } from "../_shared/vision/analyzeInspectionPhoto.ts"
import { createInspectionUploadSignedUrl } from "../_shared/vision/dibSmartAdd.ts"
import {
  generateInspectionCaptureToken,
  hashInspectionCaptureToken,
  timingSafeEqualHex,
} from "../_shared/inspectionCapture/token.ts"
import {
  MAX_INSPECTION_CAPTURE_BYTES,
  resolveInspectionCaptureMime,
} from "../_shared/inspectionCapture/mime.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SESSION_TTL_MS = 20 * 60 * 1000
const MAX_PHOTOS = 20
const CREATE_PER_HOUR = 12
const INVALID_LINK = "This capture link is invalid or has expired."

const LANDLORD_ACTIONS = new Set(["create_session", "complete_session", "list_photos"])

type CaptureSession = {
  id: string
  landlord_id: string
  property_id: string
  assessment_id: string | null
  token_hash: string
  status: string
  expires_at: string
  connected_at: string | null
  completed_at: string | null
}

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

function formatPropertyLabel(row: {
  name?: string | null
  street_address?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
} | null, fallback: string): { name: string; address: string } {
  const name = row?.name?.trim() || fallback
  const parts = [
    row?.street_address?.trim(),
    [row?.city?.trim(), row?.state?.trim()].filter(Boolean).join(", "),
    row?.zip_code?.trim(),
  ].filter(Boolean)
  return { name, address: parts.join(" · ") }
}

function isOpenStatus(status: string): boolean {
  return status === "waiting" || status === "connected" || status === "active"
}

async function expireIfNeeded(
  supabase: SupabaseClient,
  session: CaptureSession,
): Promise<CaptureSession> {
  if (!isOpenStatus(session.status)) return session
  if (Date.parse(session.expires_at) > Date.now()) return session
  await supabase
    .from("inspection_capture_sessions")
    .update({ status: "expired", completed_at: new Date().toISOString() })
    .eq("id", session.id)
    .in("status", ["waiting", "connected", "active"])
  return { ...session, status: "expired" }
}

async function loadSessionById(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<CaptureSession | null> {
  const { data } = await supabase
    .from("inspection_capture_sessions")
    .select(
      "id, landlord_id, property_id, assessment_id, token_hash, status, expires_at, connected_at, completed_at",
    )
    .eq("id", sessionId)
    .maybeSingle()
  return (data as CaptureSession | null) ?? null
}

async function authorizeTokenSession(
  supabase: SupabaseClient,
  sessionId: string,
  token: string,
): Promise<{ session: CaptureSession } | { error: string; status: number }> {
  if (!uuidRe.test(sessionId) || token.length < 32 || token.length > 128) {
    return { error: INVALID_LINK, status: 404 }
  }
  const hash = await hashInspectionCaptureToken(token)
  const session = await loadSessionById(supabase, sessionId)
  const dummy = "0".repeat(64)
  const match = timingSafeEqualHex(session?.token_hash ?? dummy, hash)
  if (!session || !match) {
    return { error: INVALID_LINK, status: 404 }
  }
  const current = await expireIfNeeded(supabase, session)
  if (current.status === "completed" || current.status === "revoked") {
    return { error: "This capture session has ended.", status: 410 }
  }
  if (current.status === "expired") {
    return { error: "This capture session has expired.", status: 410 }
  }
  return { session: current }
}

function mapSessionPublic(session: CaptureSession, extra: Record<string, unknown> = {}) {
  return {
    id: session.id,
    status: session.status,
    expiresAt: session.expires_at,
    connectedAt: session.connected_at,
    assessmentId: session.assessment_id,
    photoCount: extra.photoCount ?? 0,
    propertyName: extra.propertyName ?? "",
    propertyAddress: extra.propertyAddress ?? "",
  }
}

async function propertyLabel(
  supabase: SupabaseClient,
  propertyId: string,
  fallback: string,
): Promise<{ name: string; address: string }> {
  const { data } = await supabase
    .from("properties")
    .select("name, street_address, city, state, zip_code")
    .eq("id", propertyId)
    .maybeSingle()
  return formatPropertyLabel(data, fallback)
}

async function photoCount(supabase: SupabaseClient, sessionId: string): Promise<number> {
  const { count } = await supabase
    .from("inspection_capture_photos")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
  return count ?? 0
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

  try {
    if (LANDLORD_ACTIONS.has(action)) {
      if (!landlordId || !uuidRe.test(landlordId)) {
        return jsonResponse({ error: "landlordId is required" }, 400)
      }
    }

    if (action === "create_session") {
      const assessmentId = asString(body.assessmentId)
      if (!assessmentId || !uuidRe.test(assessmentId)) {
        return jsonResponse({ error: "assessmentId is required" }, 400)
      }

      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count: createdCount } = await supabase
        .from("inspection_capture_sessions")
        .select("id", { count: "exact", head: true })
        .eq("landlord_id", landlordId)
        .gte("created_at", hourAgo)
      if ((createdCount ?? 0) >= CREATE_PER_HOUR) {
        return jsonResponse({ error: "Too many capture sessions. Try again later." }, 429)
      }

      const { data: assessment, error: aErr } = await supabase
        .from("property_inspection_assessments")
        .select("id, landlord_id, building, property_id")
        .eq("id", assessmentId)
        .eq("landlord_id", landlordId)
        .maybeSingle()
      if (aErr || !assessment) {
        return jsonResponse({ error: "Assessment not found" }, 404)
      }

      let propertyId = assessment.property_id != null ? String(assessment.property_id) : ""
      if (!propertyId) {
        const scope = await resolveOperationsGraphScope(supabase, {
          landlordId,
          building: String(assessment.building),
        })
        propertyId = scope.propertyId ?? ""
      }
      if (!propertyId || !uuidRe.test(propertyId)) {
        return jsonResponse({ error: "Property not found for this inspection" }, 400)
      }

      await supabase
        .from("inspection_capture_sessions")
        .update({
          status: "revoked",
          completed_at: new Date().toISOString(),
        })
        .eq("assessment_id", assessmentId)
        .eq("landlord_id", landlordId)
        .in("status", ["waiting", "connected", "active"])

      const token = generateInspectionCaptureToken()
      const tokenHash = await hashInspectionCaptureToken(token)
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

      const { data: session, error: sErr } = await supabase
        .from("inspection_capture_sessions")
        .insert({
          landlord_id: landlordId,
          property_id: propertyId,
          assessment_id: assessmentId,
          token_hash: tokenHash,
          status: "waiting",
          expires_at: expiresAt,
        })
        .select(
          "id, landlord_id, property_id, assessment_id, token_hash, status, expires_at, connected_at, completed_at",
        )
        .single()
      if (sErr || !session) {
        return jsonResponse({ error: sErr?.message ?? "Could not create capture session" }, 500)
      }

      const label = await propertyLabel(supabase, propertyId, String(assessment.building))
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "inspection.capture_session_started",
        source: "dashboard",
        actorType: "landlord",
        propertyId,
        metadata: {
          message: "Phone photo capture started for this inspection.",
          assessmentId,
          sessionId: session.id,
        },
      })

      return jsonResponse({
        session: mapSessionPublic(session as CaptureSession, {
          photoCount: 0,
          propertyName: label.name,
          propertyAddress: label.address,
        }),
        token,
      })
    }

    if (action === "complete_session") {
      const sessionId = asString(body.sessionId)
      if (!sessionId || !uuidRe.test(sessionId)) {
        return jsonResponse({ error: "sessionId is required" }, 400)
      }
      const session = await loadSessionById(supabase, sessionId)
      if (!session || session.landlord_id !== landlordId) {
        return jsonResponse({ error: "Session not found" }, 404)
      }
      if (isOpenStatus(session.status)) {
        await supabase
          .from("inspection_capture_sessions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", sessionId)
          .eq("landlord_id", landlordId)
      }
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "inspection.capture_session_ended",
        source: "dashboard",
        actorType: "landlord",
        propertyId: session.property_id,
        metadata: {
          message: "Phone photo capture ended.",
          sessionId,
        },
      })
      return jsonResponse({ ok: true })
    }

    if (action === "list_photos") {
      const sessionId = asString(body.sessionId)
      if (!sessionId || !uuidRe.test(sessionId)) {
        return jsonResponse({ error: "sessionId is required" }, 400)
      }
      const session = await loadSessionById(supabase, sessionId)
      if (!session || session.landlord_id !== landlordId) {
        return jsonResponse({ error: "Session not found" }, 404)
      }
      const current = await expireIfNeeded(supabase, session)
      const { data: rows, error } = await supabase
        .from("inspection_capture_photos")
        .select(
          "id, session_id, property_id, landlord_id, inspection_photo_id, storage_path, mime_type, file_size, source, processing_status, created_at",
        )
        .eq("session_id", sessionId)
        .eq("landlord_id", landlordId)
        .order("created_at", { ascending: true })
      if (error) return jsonResponse({ error: error.message }, 500)

      const photos = []
      for (const row of rows ?? []) {
        const previewUrl = await createInspectionUploadSignedUrl(
          supabase,
          String(row.storage_path),
        )
        photos.push({
          id: String(row.id),
          inspectionPhotoId: row.inspection_photo_id != null
            ? String(row.inspection_photo_id)
            : null,
          storagePath: String(row.storage_path),
          mimeType: row.mime_type != null ? String(row.mime_type) : null,
          fileSize: typeof row.file_size === "number" ? row.file_size : null,
          source: String(row.source ?? "mobile_capture"),
          processingStatus: String(row.processing_status),
          createdAt: String(row.created_at),
          previewUrl,
        })
      }

      const label = await propertyLabel(supabase, current.property_id, "Property")
      return jsonResponse({
        session: mapSessionPublic(current, {
          photoCount: photos.length,
          propertyName: label.name,
          propertyAddress: label.address,
        }),
        photos,
      })
    }

    if (action === "get_session") {
      const sessionId = asString(body.sessionId)
      const token = asString(body.token)
      const auth = await authorizeTokenSession(supabase, sessionId, token)
      if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status)

      let session = auth.session
      if (session.status === "waiting") {
        const now = new Date().toISOString()
        await supabase
          .from("inspection_capture_sessions")
          .update({ status: "connected", connected_at: now })
          .eq("id", session.id)
          .eq("status", "waiting")
        session = { ...session, status: "connected", connected_at: now }
      }

      const { data: assessment } = session.assessment_id
        ? await supabase
          .from("property_inspection_assessments")
          .select("building")
          .eq("id", session.assessment_id)
          .maybeSingle()
        : { data: null }
      const label = await propertyLabel(
        supabase,
        session.property_id,
        assessment?.building ? String(assessment.building) : "Property",
      )
      const count = await photoCount(supabase, session.id)
      return jsonResponse({
        session: mapSessionPublic(session, {
          photoCount: count,
          propertyName: label.name,
          propertyAddress: label.address,
        }),
      })
    }

    if (action === "upload_photo") {
      const sessionId = asString(body.sessionId)
      const token = asString(body.token)
      const auth = await authorizeTokenSession(supabase, sessionId, token)
      if ("error" in auth) return jsonResponse({ error: auth.error }, auth.status)
      const session = auth.session

      if (!session.assessment_id) {
        return jsonResponse({ error: "This capture session is missing an inspection." }, 400)
      }

      const imageBase64 = asString(body.imageBase64)
      if (!imageBase64) return jsonResponse({ error: "imageBase64 is required" }, 400)
      const bytes = decodeBase64(imageBase64)
      if (!bytes?.length) return jsonResponse({ error: "Invalid image data" }, 400)
      if (bytes.length > MAX_INSPECTION_CAPTURE_BYTES) {
        return jsonResponse({ error: "File must be 10MB or smaller" }, 400)
      }

      const mime = resolveInspectionCaptureMime(bytes, asString(body.contentType) || "image/jpeg")
      if (!mime) {
        return jsonResponse({ error: "Use a JPG, PNG, WEBP, or HEIC photo." }, 400)
      }

      const count = await photoCount(supabase, session.id)
      if (count >= MAX_PHOTOS) {
        return jsonResponse({ error: "Maximum 20 photos per session." }, 400)
      }

      const { count: assessmentCount } = await supabase
        .from("property_inspection_photos")
        .select("id", { count: "exact", head: true })
        .eq("assessment_id", session.assessment_id)
      if ((assessmentCount ?? 0) >= MAX_PHOTOS) {
        return jsonResponse({ error: "Maximum 20 files per inspection session." }, 400)
      }

      const { data: assessment, error: aErr } = await supabase
        .from("property_inspection_assessments")
        .select("id, building, landlord_id, property_id")
        .eq("id", session.assessment_id)
        .eq("landlord_id", session.landlord_id)
        .maybeSingle()
      if (aErr || !assessment) {
        return jsonResponse({ error: INVALID_LINK }, 404)
      }
      if (
        assessment.property_id != null &&
        String(assessment.property_id) !== session.property_id
      ) {
        return jsonResponse({ error: INVALID_LINK }, 403)
      }

      const fileName = asString(body.fileName) || "inspection-photo.jpg"
      const { data: photoRow, error: pErr } = await supabase
        .from("property_inspection_photos")
        .insert({
          assessment_id: session.assessment_id,
          landlord_id: session.landlord_id,
          file_name: fileName,
          content_type: mime,
          status: "queued",
        })
        .select("*")
        .single()
      if (pErr || !photoRow) {
        return jsonResponse({ error: pErr?.message ?? "Failed to save photo" }, 500)
      }

      const photoId = String(photoRow.id)
      const ext = mime.includes("png")
        ? "png"
        : mime.includes("webp")
          ? "webp"
          : mime.includes("heic")
            ? "heic"
            : mime.includes("heif")
              ? "heif"
              : "jpg"
      const storagePath =
        `${session.landlord_id}/${buildingKey(String(assessment.building))}/${session.assessment_id}/${photoId}.${ext}`

      const { error: upErr } = await supabase.storage
        .from("inspection-uploads")
        .upload(storagePath, bytes, { contentType: mime, upsert: true })
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

      const { data: captureRow, error: cErr } = await supabase
        .from("inspection_capture_photos")
        .insert({
          session_id: session.id,
          property_id: session.property_id,
          landlord_id: session.landlord_id,
          inspection_photo_id: photoId,
          storage_path: storagePath,
          mime_type: mime,
          file_size: bytes.length,
          source: "mobile_capture",
          processing_status: "uploaded",
        })
        .select("id")
        .single()
      if (cErr || !captureRow) {
        return jsonResponse({ error: cErr?.message ?? "Failed to record capture photo" }, 500)
      }

      if (session.status === "waiting" || session.status === "connected") {
        await supabase
          .from("inspection_capture_sessions")
          .update({
            status: "active",
            connected_at: session.connected_at ?? new Date().toISOString(),
          })
          .eq("id", session.id)
          .in("status", ["waiting", "connected"])
      }

      await recordActivityLog(supabase, {
        landlordId: session.landlord_id,
        eventType: "inspection.capture_photo_received",
        source: "edge_function",
        actorType: "landlord",
        propertyId: session.property_id,
        metadata: {
          message: "A phone photo was added to this inspection.",
          sessionId: session.id,
          photoId,
        },
      })

      const captureId = String(captureRow.id)
      await supabase
        .from("inspection_capture_photos")
        .update({ processing_status: "analyzing" })
        .eq("id", captureId)
      const analyzed = await analyzeInspectionPhotoRow(
        supabase,
        photoId,
        imageBase64,
        mime,
        null,
        "photo",
        storagePath,
      )
      const processingStatus = String(analyzed.status ?? "") === "error" ? "error" : "ready"
      await supabase
        .from("inspection_capture_photos")
        .update({ processing_status: processingStatus })
        .eq("id", captureId)

      const previewUrl = await createInspectionUploadSignedUrl(supabase, storagePath)
      return jsonResponse({
        ok: true,
        photo: {
          id: captureId,
          inspectionPhotoId: photoId,
          processingStatus,
          previewUrl,
        },
        photoCount: count + 1,
      })
    }

    return jsonResponse({ error: `Unknown action: ${action || "(empty)"}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    console.error("[inspection-capture]", action, message)
    return jsonResponse({ error: message }, 500)
  }
})
