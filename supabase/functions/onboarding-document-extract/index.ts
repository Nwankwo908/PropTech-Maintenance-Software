/**
 * Onboarding fast-track document extraction (GPT-4o).
 *
 * POST {
 *   landlordId,
 *   docId,
 *   fileName,
 *   documentCategory,
 *   storageBucket?,
 *   storagePath?,
 *   fileBase64?
 * }
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { isPortalAdminEmailAllowed } from "../../../shared/admin/staffAllowlist.ts"
import {
  extractPortfolioDocument,
  portfolioExtractHasData,
  type PortfolioDocumentExtractPayload,
} from "../_shared/onboarding/portfolioDocumentExtract.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ONBOARDING_LANDLORD_IDS = new Set([
  "068daf53-07e4-4493-bd7f-6106e3c8c62f",
  "de300000-0000-4000-8000-000000000002",
])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
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

async function authorizeStaff(req: Request, supabaseUrl: string, anonKey: string) {
  const token = bearerToken(req)
  if (!token) {
    return { ok: false as const, response: jsonResponse({ error: "Authorization required" }, 401) }
  }
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user?.email) {
    return { ok: false as const, response: jsonResponse({ error: "Invalid session" }, 401) }
  }
  if (!isPortalAdminEmailAllowed(data.user.email)) {
    return { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 403) }
  }
  return { ok: true as const }
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim()
  const openAiKey = Deno.env.get("OPENAI_API_KEY")?.trim()

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }
  if (!openAiKey) {
    return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 500)
  }

  const auth = await authorizeStaff(req, supabaseUrl, anonKey)
  if (!auth.ok) return auth.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const landlordId = asString(body.landlordId)
  const docId = asString(body.docId)
  const fileName = asString(body.fileName)
  const documentCategory = asString(body.documentCategory)
  const storageBucket = asString(body.storageBucket) || "landlord-onboarding-documents"
  const storagePath = asString(body.storagePath)
  const fileBase64 = asString(body.fileBase64)

  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "landlordId is required" }, 400)
  }
  if (!ONBOARDING_LANDLORD_IDS.has(landlordId)) {
    return jsonResponse({ error: "Landlord not eligible for onboarding extract" }, 403)
  }
  if (!docId || !fileName) {
    return jsonResponse({ error: "docId and fileName are required" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let bytes: Uint8Array | null = null
  let contentType = asString(body.contentType) || "application/octet-stream"

  if (fileBase64) {
    bytes = decodeBase64(fileBase64)
  } else if (storagePath) {
    const { data, error } = await supabase.storage.from(storageBucket).download(storagePath)
    if (error || !data) {
      return jsonResponse({ error: error?.message ?? "Could not download document" }, 400)
    }
    const buffer = await data.arrayBuffer()
    bytes = new Uint8Array(buffer)
    if (!contentType || contentType === "application/octet-stream") {
      contentType = data.type || contentType
    }
  }

  if (!bytes || bytes.length === 0) {
    return jsonResponse({ error: "Document bytes are required" }, 400)
  }
  if (bytes.length > 20 * 1024 * 1024) {
    return jsonResponse({ error: "Document exceeds 20MB limit" }, 400)
  }

  try {
    const extracted: PortfolioDocumentExtractPayload = await extractPortfolioDocument({
      apiKey: openAiKey,
      fileName,
      documentCategory,
      contentType,
      bytes,
    })

    const hasData = portfolioExtractHasData(extracted)
    const needsAttention =
      !hasData ||
      extracted.warnings.some((w) => /not supported|not parsed|upload pdf|upload csv/i.test(w))

    return jsonResponse({
      ok: true,
      docId,
      extracted,
      hasData,
      needsAttention,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Document extract failed"
    console.error("[onboarding-document-extract]", message)
    return jsonResponse({ error: message }, 500)
  }
})
