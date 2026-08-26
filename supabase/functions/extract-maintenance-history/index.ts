/**
 * POST extract-maintenance-history — extract job rows from invoice/receipt/CSV.
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { extractMaintenanceHistoryFromDocument } from "../_shared/maintenance/historyDocumentExtract.ts"

const corsHeaders = adminEdgeCorsHeaders

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const auth = requireAdminReassignAuth(req, "[extract-maintenance-history]", corsHeaders)
  if (!auth.ok) return auth.response

  const openAiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!openAiKey) {
    return jsonResponse({ error: "OPENAI_API_KEY is not configured" }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const fileName = asString(body.fileName ?? body.file_name)
  const contentType = asString(body.contentType ?? body.content_type) ||
    "application/octet-stream"
  const buildingName = asString(body.buildingName ?? body.building)
  const fileBase64 = asString(body.fileBase64 ?? body.file_base64)

  if (!fileName) {
    return jsonResponse({ error: "fileName is required" }, 400)
  }
  if (!fileBase64) {
    return jsonResponse({ error: "fileBase64 is required" }, 400)
  }

  const bytes = decodeBase64(fileBase64)
  if (!bytes || bytes.length === 0) {
    return jsonResponse({ error: "Could not decode fileBase64" }, 400)
  }
  if (bytes.length > 12 * 1024 * 1024) {
    return jsonResponse({ error: "File exceeds 12MB limit" }, 400)
  }

  try {
    const result = await extractMaintenanceHistoryFromDocument({
      apiKey: openAiKey,
      fileName,
      contentType,
      bytes,
      buildingName: buildingName || undefined,
    })
    return jsonResponse({
      ok: true,
      records: result.records,
      warnings: result.warnings,
      method: result.method,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extract failed"
    console.error("[extract-maintenance-history]", message)
    return jsonResponse({ error: message }, 500)
  }
})
