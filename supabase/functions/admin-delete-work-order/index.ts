/**
 * Soft-archive a maintenance work order (no hard-delete).
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 *
 * Preserves the ticket + estimates + activity history. Notifies the assigned
 * vendor via terminateWorkOrder. Cancels linked workflow runs.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { detachDeletedTicketFromSmsConversations } from "../_shared/sms/detachTicketFromConversations.ts"
import { terminateWorkOrder } from "../_shared/terminateWorkOrder.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MAINTENANCE_TEMPLATES = new Set([
  "maintenance_request",
  "maintenance_intake",
])

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

function metaString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!metadata || typeof metadata !== "object") return null
  return asUuid(metadata[key])
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  const adminAuth = requireAdminReassignAuth(req, "[admin-delete-work-order]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: {
    landlordId?: string
    workflowRunId?: string
    maintenanceRequestId?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = asUuid(body.landlordId)
  const workflowRunId = asUuid(body.workflowRunId)
  const bodyTicketId = asUuid(body.maintenanceRequestId)

  if (!landlordId) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  if (!workflowRunId) {
    return jsonResponse({ error: "Missing or invalid workflowRunId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: run, error: runErr } = await supabase
    .from("workflow_runs")
    .select("id, landlord_id, template_id, entity_type, entity_id, metadata")
    .eq("id", workflowRunId)
    .maybeSingle()

  if (runErr) {
    console.error("[admin-delete-work-order] load run", runErr.message)
    return jsonResponse({ error: "Load workflow failed" }, 500)
  }
  if (!run) {
    return jsonResponse({ error: "Workflow not found" }, 404)
  }
  if (String(run.landlord_id) !== landlordId) {
    return jsonResponse({ error: "Forbidden" }, 403)
  }

  const templateId = String(run.template_id ?? "")
  if (!MAINTENANCE_TEMPLATES.has(templateId)) {
    return jsonResponse(
      { error: "Only maintenance work orders can be archived here" },
      400,
    )
  }

  const meta = (run.metadata ?? {}) as Record<string, unknown>
  const ticketId =
    bodyTicketId ||
    (String(run.entity_type ?? "") === "maintenance_request"
      ? asUuid(run.entity_id)
      : null) ||
    metaString(meta, "maintenance_request_id") ||
    metaString(meta, "draft_ticket_id")

  if (!ticketId) {
    // Run-only archive: cancel the run without a ticket row.
    await supabase
      .from("workflow_runs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", workflowRunId)
      .eq("landlord_id", landlordId)
    return jsonResponse({
      ok: true,
      workflowRunId,
      maintenanceRequestId: null,
      deletedRunIds: [workflowRunId],
      archived: true,
    })
  }

  const result = await terminateWorkOrder(supabase, {
    landlordId,
    ticketId,
    mode: "archive",
    source: "admin_api",
    actorType: "admin",
    reason: "Archived from the workflow pipeline",
    closeWorkflowRuns: true,
    notifyVendor: true,
  })

  if (!result.ok) {
    return jsonResponse({ error: result.error }, 400)
  }

  let smsConversationsDetached = 0
  try {
    const detached = await detachDeletedTicketFromSmsConversations(supabase, {
      ticketId,
      landlordId,
    })
    smsConversationsDetached = detached.conversationsUpdated
  } catch (e) {
    console.error("[admin-delete-work-order] detach SMS conversations", e)
  }

  // Ensure the explicitly selected run is cancelled.
  await supabase
    .from("workflow_runs")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", workflowRunId)
    .eq("landlord_id", landlordId)

  return jsonResponse({
    ok: true,
    workflowRunId,
    maintenanceRequestId: ticketId,
    deletedRunIds: [],
    smsConversationsDetached,
    archived: true,
    vendorNotify: result.vendorNotify,
    terminationId: result.terminationId,
  })
})
