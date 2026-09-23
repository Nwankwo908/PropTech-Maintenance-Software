/**
 * Soft-terminate (cancel/archive) a maintenance work order.
 * Replaces hard-delete for assigned tickets. Auth: ADMIN_REASSIGN_SECRET.
 *
 *   curl -X POST ".../functions/v1/terminate-work-order" \
 *     -H "Authorization: Bearer $ADMIN_REASSIGN_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlordId":"...","ticketId":"...","mode":"cancel","source":"dashboard"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import {
  terminateWorkOrder,
  type TerminateMode,
  type TerminateSource,
} from "../_shared/terminateWorkOrder.ts"
import { detachDeletedTicketFromSmsConversations } from "../_shared/sms/detachTicketFromConversations.ts"

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
  const adminAuth = requireAdminReassignAuth(req, "[terminate-work-order]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = asUuid(body.landlordId)
  const ticketId = asUuid(body.ticketId) ?? asUuid(body.maintenanceRequestId)
  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "cancel"
  const mode = (
    modeRaw === "archive" || modeRaw === "release" || modeRaw === "cancel"
      ? modeRaw
      : "cancel"
  ) as TerminateMode
  const source = (
    typeof body.source === "string" && body.source.trim()
      ? body.source.trim()
      : "dashboard"
  ) as TerminateSource
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null
  const workflowRunId = asUuid(body.workflowRunId)

  if (!landlordId || !ticketId) {
    return jsonResponse({ error: "Missing landlordId or ticketId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const result = await terminateWorkOrder(supabase, {
      landlordId,
      ticketId,
      mode,
      source,
      actorType: "landlord",
      reason:
        reason ||
        (mode === "archive"
          ? "Archived from the admin dashboard"
          : source === "emergency_decline"
            ? "Emergency work declined by the property team"
            : "Cancelled from the admin dashboard"),
      closeWorkflowRuns: true,
      notifyVendor: true,
    })

    if (!result.ok) {
      return jsonResponse({ error: result.error }, 400)
    }

    // Clear SMS wait-state so AI does not keep acting on a closed WO.
    await detachDeletedTicketFromSmsConversations(supabase, {
      landlordId,
      ticketId,
    }).catch((e) => {
      console.warn("[terminate-work-order] detach conversations", e)
    })

    // If a specific run was passed, ensure it is cancelled even if linkage missed.
    if (workflowRunId) {
      await supabase
        .from("workflow_runs")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", workflowRunId)
        .eq("landlord_id", landlordId)
    }

    return jsonResponse({
      ok: true,
      ...result,
      maintenanceRequestId: ticketId,
      workflowRunId: workflowRunId,
    })
  } catch (err) {
    console.error("[terminate-work-order]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
