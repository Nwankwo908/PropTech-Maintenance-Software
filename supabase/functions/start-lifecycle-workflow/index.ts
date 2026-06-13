/**
 * Admin POST: start move_in, move_out, or inspection workflow runs.
 *
 * Body:
 *   workflow: "move_in" | "move_out" | "inspection"
 *   landlordId, unitId (required)
 *   residentId, occupancyId, unitLabel, building (optional)
 *   moveInDate, moveOutDate, scheduledAt (optional)
 *   inspectionType, skipTenantRegistration, classification (optional)
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import {
  startInspectionWorkflow,
  startMoveInWorkflow,
  startMoveOutWorkflow,
  type InspectionType,
} from "../_shared/engine/startLifecycleWorkflows.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const WORKFLOWS = new Set(["move_in", "move_out", "inspection"])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!adminReassignSecretAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const workflow = readString(body.workflow)
  if (!workflow || !WORKFLOWS.has(workflow)) {
    return jsonResponse({
      error: 'workflow must be one of: move_in, move_out, inspection',
    }, 400)
  }

  const unitId = readString(body.unitId)
  if (!unitId || !uuidRe.test(unitId)) {
    return jsonResponse({ error: "Missing or invalid unitId" }, 400)
  }

  const landlordId = readString(body.landlordId) ??
    Deno.env.get("DEFAULT_LANDLORD_ID")?.trim()
  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const residentId = readString(body.residentId)
  const occupancyId = readString(body.occupancyId)
  const unitLabel = readString(body.unitLabel)
  const building = readString(body.building)
  const moveInDate = readString(body.moveInDate)
  const moveOutDate = readString(body.moveOutDate)
  const scheduledAt = readString(body.scheduledAt)
  const inspectionType = readString(body.inspectionType) as InspectionType | null

  try {
    if (workflow === "move_in") {
      const result = await startMoveInWorkflow(supabase, {
        landlordId,
        unitId,
        residentId,
        occupancyId,
        unitLabel,
        building,
        moveInDate,
        skipTenantRegistration: body.skipTenantRegistration === true,
        triggerType: "dashboard",
        classification: body.skipTenantRegistration === true
          ? "skip_registration"
          : undefined,
      })
      return jsonResponse({
        ok: true,
        workflow,
        workflow_run_id: result.workflow_run_id,
      })
    }

    if (workflow === "move_out") {
      const result = await startMoveOutWorkflow(supabase, {
        landlordId,
        unitId,
        residentId,
        occupancyId,
        unitLabel,
        building,
        moveOutDate,
        triggerType: "dashboard",
      })
      return jsonResponse({
        ok: true,
        workflow,
        workflow_run_id: result.workflow_run_id,
      })
    }

    const result = await startInspectionWorkflow(supabase, {
      landlordId,
      unitId,
      residentId,
      occupancyId,
      unitLabel,
      building,
      scheduledAt,
      inspectionType: inspectionType ?? "periodic",
      triggerType: "dashboard",
    })

    return jsonResponse({
      ok: true,
      workflow,
      workflow_run_id: result.workflow_run_id,
    })
  } catch (err) {
    console.error("[start-lifecycle-workflow]", workflow, err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 400)
  }
})
