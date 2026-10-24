/**
 * Admin Active Tasks: move a maintenance card between kanban stages.
 * Auth: ADMIN_REASSIGN_SECRET (same as admin-reassign-vendor).
 *
 *   curl -X POST ".../functions/v1/admin-move-workflow-stage" \
 *     -H "x-admin-reassign-secret: $ADMIN_REASSIGN_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlordId":"...","runId":"...","ticketId":"...","fromStage":"assigned","toStage":"in_progress"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import { applyAdminStageMove } from "../_shared/workflowStageMove/applyAdminStageMove.ts"
import { setManualVisitTime } from "../_shared/sms/setManualVisitTime.ts"
import type { WorkflowKanbanStageId } from "../../../shared/workflowStageMove/stageMoveRules.ts"

const corsHeaders = adminEdgeCorsHeaders

const STAGES = new Set<WorkflowKanbanStageId>([
  "new_intake",
  "assigned",
  "in_progress",
  "completed",
])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function asStage(value: unknown): WorkflowKanbanStageId | null {
  if (typeof value !== "string") return null
  const t = value.trim() as WorkflowKanbanStageId
  return STAGES.has(t) ? t : null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const adminAuth = requireAdminReassignAuth(req, "[admin-move-workflow-stage]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const action = typeof body.action === "string" ? body.action.trim() : ""
  const landlordId =
    typeof body.landlordId === "string" ? body.landlordId.trim() : ""

  if (action === "set_visit_time") {
    const ticketId =
      typeof body.ticketId === "string" ? body.ticketId.trim() : ""
    const visitDate = typeof body.visitDate === "string" ? body.visitDate.trim() : ""
    const windowText = typeof body.windowText === "string" ? body.windowText.trim() : ""
    if (!landlordId || !isUuidShape(landlordId)) {
      return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
    }
    if (!ticketId || !isUuidShape(ticketId)) {
      return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Server misconfiguration" }, 500)
    }
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const result = await setManualVisitTime(supabase, {
      landlordId,
      ticketId,
      visitDate,
      windowText,
    })
    if (!result.ok) return jsonResponse({ error: result.error }, result.status)
    return jsonResponse({
      ok: true,
      scheduled_at: result.scheduledAt,
      scheduled_window_text: result.scheduledWindowText,
      vendor_texted: result.vendorTexted,
    })
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : ""
  const ticketId =
    typeof body.ticketId === "string"
      ? body.ticketId.trim()
      : typeof body.maintenanceRequestId === "string"
        ? body.maintenanceRequestId.trim()
        : ""
  const inspectionReportId =
    typeof body.inspectionReportId === "string"
      ? body.inspectionReportId.trim()
      : ""
  const ticketIds = Array.isArray(body.ticketIds)
    ? body.ticketIds
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter(Boolean)
    : []
  const fromStage = asStage(body.fromStage)
  const toStage = asStage(body.toStage)
  const note = typeof body.note === "string" ? body.note.trim() : null
  const findVendorNow = body.findVendorNow === true
  const notifyVendorAndTenant = body.notifyVendorAndTenant === true
  const actorId =
    typeof body.actorId === "string" ? body.actorId.trim() : null

  if (!landlordId || !isUuidShape(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  if (!runId || !isUuidShape(runId)) {
    return jsonResponse({ error: "Missing or invalid runId" }, 400)
  }
  if (!ticketId || !isUuidShape(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
  }
  if (inspectionReportId && !isUuidShape(inspectionReportId)) {
    return jsonResponse({ error: "Invalid inspectionReportId" }, 400)
  }
  if (ticketIds.some((id) => !isUuidShape(id))) {
    return jsonResponse({ error: "Invalid ticketIds" }, 400)
  }
  if (!fromStage || !toStage) {
    return jsonResponse({ error: "Invalid fromStage or toStage" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await applyAdminStageMove(supabase, {
    landlordId,
    runId,
    ticketId,
    inspectionReportId: inspectionReportId || null,
    ticketIds: ticketIds.length > 0 ? ticketIds : null,
    fromStage,
    toStage,
    note,
    findVendorNow,
    notifyVendorAndTenant,
    actorId,
  })

  if (!result.ok) {
    return jsonResponse(
      {
        error: result.error,
        ...(result.currentStage ? { currentStage: result.currentStage } : {}),
      },
      result.status,
    )
  }

  return jsonResponse({
    ok: true,
    stage: result.stage,
    vendor_work_status: result.vendorWorkStatus,
    assigned_vendor_id: result.assignedVendorId,
  })
})
