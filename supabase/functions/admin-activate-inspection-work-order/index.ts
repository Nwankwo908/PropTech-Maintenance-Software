/**
 * Activate a standalone work order from a tenant inspection notice.
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { activateInspectionNoticeWorkOrder } from "../_shared/activateInspectionNoticeWorkOrder.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return uuidRe.test(t) ? t : null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const adminAuth = await requireAdminReassignAuth(
    req,
    "[admin-activate-inspection-work-order]",
    corsHeaders,
  )
  if (!adminAuth.ok) return adminAuth.response

  let body: { landlordId?: string; inspectionReportId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = asUuid(body.landlordId)
  const inspectionReportId = asUuid(body.inspectionReportId)
  if (!landlordId) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  if (!inspectionReportId) {
    return jsonResponse({ error: "Missing or invalid inspectionReportId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const landlordDenied = await adminAuth.denyUnless(supabase, landlordId)
  if (landlordDenied) return landlordDenied
  const result = await activateInspectionNoticeWorkOrder(supabase, {
    landlordId,
    inspectionReportId,
  })

  if (!result.ok) {
    return jsonResponse(
      { error: result.error },
      result.status && result.status >= 400 ? result.status : 500,
    )
  }

  return jsonResponse({
    ok: true,
    ticketId: result.ticketId,
    requestRef: result.requestRef,
    alreadyActivated: result.alreadyActivated,
    vendorAssigned: result.vendorAssigned,
  })
})
