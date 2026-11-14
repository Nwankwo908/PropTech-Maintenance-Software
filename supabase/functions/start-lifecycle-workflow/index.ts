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
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import {
  startInspectionWorkflow,
  startMoveInWorkflow,
  startMoveOutWorkflow,
  type InspectionType,
  type StartWorkflowInitialAction,
} from "../_shared/engine/startWorkflow.ts"

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

function parseInitialAction(
  body: Record<string, unknown>,
): StartWorkflowInitialAction | undefined {
  const raw = body.initialAction
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined

  const initial: StartWorkflowInitialAction = {}
  const moveIn = (raw as Record<string, unknown>).moveIn
  if (moveIn && typeof moveIn === "object" && !Array.isArray(moveIn)) {
    const action = readString((moveIn as Record<string, unknown>).action)
    if (action === "register_and_outreach" || action === "send_outreach") {
      initial.moveIn = { action }
    }
  }

  const moveOut = (raw as Record<string, unknown>).moveOut
  if (moveOut && typeof moveOut === "object" && !Array.isArray(moveOut)) {
    const action = readString((moveOut as Record<string, unknown>).action)
    if (action === "send_outreach") {
      initial.moveOut = { action }
    }
  }

  const inspection = (raw as Record<string, unknown>).inspection
  if (inspection && typeof inspection === "object" && !Array.isArray(inspection)) {
    const action = readString((inspection as Record<string, unknown>).action)
    if (action === "send_outreach" || action === "register_and_outreach") {
      initial.inspection = { action }
    }
  }

  return initial.moveIn || initial.moveOut || initial.inspection ? initial : undefined
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

  const landlordId = readString(body.landlordId)
  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }

  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  let residentId = readString(body.residentId)
  const occupancyId = readString(body.occupancyId)
  let unitLabel = readString(body.unitLabel)
  let building = readString(body.building)
  const moveInDate = readString(body.moveInDate)
  const moveOutDate = readString(body.moveOutDate)
  const scheduledAt = readString(body.scheduledAt)
  const inspectionType = readString(body.inspectionType) as InspectionType | null
  const initialAction = parseInitialAction(body)

  try {
    if ([body.residentId, body.occupancyId].some(v => v != null && v !== "" && (typeof v !== "string" || !uuidRe.test(v.trim())))) return jsonResponse({ error: "Invalid resident or occupancy ID" }, 400)
    const { data: unit, error: unitError } = await supabase.from("units").select("id, unit_label, building, property_id").eq("id", unitId).eq("landlord_id", landlordId).maybeSingle()
    if (unitError) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
    if (!unit) return jsonResponse({ error: "Unit not found" }, 404)
    if (unit.property_id) {
      const { data, error } = await supabase.from("properties").select("id").eq("id", unit.property_id).eq("landlord_id", landlordId).maybeSingle()
      if (error) return jsonResponse({ error: "Property lookup unavailable" }, 503)
      if (!data) return jsonResponse({ error: "Property not found" }, 404)
    }
    unitLabel = String(unit.unit_label)
    building = typeof unit.building === "string" ? unit.building : null
    if (occupancyId) {
      const { data: occupancy, error } = await supabase.from("occupancy").select("id, resident_id").eq("id", occupancyId).eq("landlord_id", landlordId).eq("unit_id", unitId).maybeSingle()
      if (error) return jsonResponse({ error: "Occupancy lookup unavailable" }, 503)
      if (!occupancy || residentId && occupancy.resident_id !== residentId) return jsonResponse({ error: "Occupancy not found for this unit/resident" }, 404)
      if (!residentId && typeof occupancy.resident_id === "string") residentId = occupancy.resident_id
    }
    if (residentId) {
      const { data, error } = await supabase.from("users").select("id").eq("id", residentId).eq("landlord_id", landlordId).maybeSingle()
      if (error) return jsonResponse({ error: "Resident lookup unavailable" }, 503)
      if (!data) return jsonResponse({ error: "Resident not found" }, 404)
    }
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
        initialAction,
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
        initialAction,
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
      initialAction,
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
