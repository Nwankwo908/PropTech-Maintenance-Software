/**
 * Public tokenized completion photo upload + job close (Phase 4 / 4.4).
 * Auth: maintenance_requests.vendor_action_token (same as /w/:token).
 *
 * POST JSON { token, action: "resolve" | "complete" }
 * POST multipart: token, action=upload, photo file parts
 * POST JSON { token, action: "upload", photos: [{ base64, contentType, fileName? }] }
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  completeJobWithPhotos,
  loadCompletionContextForJobToken,
  uploadCompletionPhotos,
  type CompletionPhotoInput,
} from "../_shared/maintenanceCompletion.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
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

async function photosFromJson(body: {
  photos?: unknown
}): Promise<CompletionPhotoInput[]> {
  if (!Array.isArray(body.photos)) return []
  const out: CompletionPhotoInput[] = []
  for (const item of body.photos) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const b64 = typeof o.base64 === "string" ? o.base64 : ""
    const contentType =
      typeof o.contentType === "string" ? o.contentType : "image/jpeg"
    const fileName = typeof o.fileName === "string" ? o.fileName : undefined
    const bytes = decodeBase64(b64)
    if (!bytes?.length) continue
    out.push({ bytes, contentType, fileName })
  }
  return out
}

async function photosFromForm(
  form: FormData,
): Promise<CompletionPhotoInput[]> {
  const out: CompletionPhotoInput[] = []
  for (const part of form.getAll("photo")) {
    if (!(part instanceof File) || part.size === 0) continue
    const bytes = new Uint8Array(await part.arrayBuffer())
    out.push({
      bytes,
      contentType: part.type || "image/jpeg",
      fileName: part.name,
    })
  }
  return out
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

  const contentType = req.headers.get("content-type") ?? ""
  let token = ""
  let action = "resolve"
  let photos: CompletionPhotoInput[] = []

  if (contentType.includes("multipart/form-data")) {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return jsonResponse({ error: "Expected multipart form" }, 400)
    }
    token = String(form.get("token") ?? "").trim()
    action = String(form.get("action") ?? "upload").trim().toLowerCase()
    photos = await photosFromForm(form)
  } else {
    let body: {
      token?: string
      action?: string
      photos?: unknown
    }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: "Expected JSON body" }, 400)
    }
    token = typeof body.token === "string" ? body.token.trim() : ""
    action = (body.action ?? "resolve").trim().toLowerCase()
    if (action === "upload") {
      photos = await photosFromJson(body)
    }
  }

  if (!token || !uuidRe.test(token)) {
    return jsonResponse({ error: "Invalid job token" }, 400)
  }

  if (action === "resolve") {
    const ctx = await loadCompletionContextForJobToken(supabase, token)
    if (!ctx.ok) {
      return jsonResponse({ error: ctx.error }, ctx.status)
    }
    return jsonResponse({
      ok: true,
      ticketId: ctx.ticketId,
      workOrderRef: ctx.workOrderRef,
      unit: ctx.unit,
      description: ctx.description,
      vendorWorkStatus: ctx.vendorWorkStatus,
      completionPhotoCount: ctx.completionPhotoCount,
      completionPhotoUrls: ctx.completionPhotoUrls,
      canComplete: ctx.canComplete,
      alreadyCompleted: ctx.alreadyCompleted,
    })
  }

  const ctx = await loadCompletionContextForJobToken(supabase, token)
  if (!ctx.ok) {
    return jsonResponse({ error: ctx.error }, ctx.status)
  }

  if (action === "upload") {
    const result = await uploadCompletionPhotos(supabase, {
      ticketId: ctx.ticketId,
      vendorId: ctx.vendorId,
      photos,
    })
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status ?? 400)
    }
    const refreshed = await loadCompletionContextForJobToken(supabase, token)
    return jsonResponse({
      ok: true,
      added: result.added,
      completionPhotoCount: result.completionPhotoCount,
      canComplete: refreshed.ok ? refreshed.canComplete : result.completionPhotoCount >= 1,
      completionPhotoUrls: refreshed.ok ? refreshed.completionPhotoUrls : [],
      message: `Uploaded ${result.added} photo${result.added === 1 ? "" : "s"}.`,
    })
  }

  if (action === "complete") {
    const result = await completeJobWithPhotos(supabase, {
      ticketId: ctx.ticketId,
      vendorId: ctx.vendorId,
      jobToken: token,
    })
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status ?? 400)
    }
    return jsonResponse({
      ok: true,
      photoCount: result.photoCount,
      message: result.message,
      vendorWorkStatus: "completed",
    })
  }

  return jsonResponse({ error: "Unknown action" }, 400)
})
