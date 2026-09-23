/**
 * POST start-insight-inspection-scheduling
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { startInsightInspectorScheduling } from "../_shared/insightInspectorScheduling.ts"
import type { InsightRecommendationActionType } from "../../../shared/portfolioIntelligence/types.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  const auth = requireAdminReassignAuth(req, "[start-insight-inspection-scheduling]")
  if (!auth.ok) {
    return auth.response
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const landlordId = typeof body.landlordId === "string"
    ? body.landlordId.trim()
    : typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  const insightCardId = typeof body.insightCardId === "string"
    ? body.insightCardId.trim()
    : typeof body.insight_card_id === "string"
    ? body.insight_card_id.trim()
    : ""
  const actionType = String(body.actionType ?? body.action_type ?? "").trim() as
    InsightRecommendationActionType

  if (!landlordId || !insightCardId || !actionType) {
    return jsonResponse({ error: "landlordId, insightCardId, and actionType are required" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const result = await startInsightInspectorScheduling(supabase, {
    landlordId,
    insightCardId,
    actionType,
    unitId: typeof body.unitId === "string" ? body.unitId : null,
    unitLabel: typeof body.unitLabel === "string" ? body.unitLabel : null,
    building: typeof body.building === "string" ? body.building : null,
    categoryLabel: typeof body.categoryLabel === "string" ? body.categoryLabel : null,
    issueSummary: typeof body.issueSummary === "string"
      ? body.issueSummary
      : typeof body.text === "string"
      ? body.text
      : null,
    targetDay: typeof body.targetDay === "string" ? body.targetDay : null,
    propertyState: typeof body.propertyState === "string" ? body.propertyState : null,
    timeZone: typeof body.timeZone === "string" ? body.timeZone : null,
  })

  if (!result.ok) {
    return jsonResponse({ error: result.error }, 400)
  }
  return jsonResponse(result)
})
