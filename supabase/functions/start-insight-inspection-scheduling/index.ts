/**
 * POST start-insight-inspection-scheduling
 * Auth: verified account session.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { startInsightInspectorScheduling } from "../_shared/insightInspectorScheduling.ts"
import type { InsightRecommendationActionType } from "../_shared/portfolioIntelligence/types.ts"

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

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
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

  if (!isUuidShape(landlordId) || !insightCardId || !["schedule_inspection", "schedule_building_inspection", "schedule_unit_walkthrough", "request_diagnostic"].includes(actionType)) {
    return jsonResponse({ error: "landlordId, insightCardId, and actionType are required" }, 400)
  }

  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  let unitId: string | null = null
  let unitLabel = typeof body.unitLabel === "string" ? body.unitLabel : null
  let building = typeof body.building === "string" ? body.building : null
  if (body.unitId != null && body.unitId !== "") {
    if (typeof body.unitId !== "string" || !isUuidShape(body.unitId.trim())) return jsonResponse({ error: "Invalid unitId" }, 400)
    unitId = body.unitId.trim()
    const { data: unit, error } = await supabase.from("units").select("id, unit_label, building, property_id").eq("id", unitId).eq("landlord_id", landlordId).maybeSingle()
    if (error) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
    if (!unit) return jsonResponse({ error: "Unit not found" }, 404)
    if (unit.property_id) {
      const property = await supabase.from("properties").select("id").eq("id", unit.property_id).eq("landlord_id", landlordId).maybeSingle()
      if (property.error) return jsonResponse({ error: "Property lookup unavailable" }, 503)
      if (!property.data) return jsonResponse({ error: "Property not found" }, 404)
    }
    unitLabel = String(unit.unit_label)
    building = typeof unit.building === "string" ? unit.building : null
  }
  const result = await startInsightInspectorScheduling(supabase, {
    landlordId,
    insightCardId,
    actionType,
    unitId,
    unitLabel,
    building,
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
