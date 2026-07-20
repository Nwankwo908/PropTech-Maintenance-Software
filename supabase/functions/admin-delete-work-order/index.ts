/**
 * Permanently delete a maintenance work order from the workflow pipeline.
 * Auth: ADMIN_REASSIGN_SECRET via x-admin-reassign-secret.
 *
 * Removes the ticket + all linked maintenance_intake / maintenance_request runs.
 * SMS threads are left in place (maintenance_request_id SET NULL) so shared
 * resident conversations are not wiped.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"

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

async function collectMaintenanceRunIds(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    workflowRunId: string
    ticketId: string | null
  },
): Promise<string[]> {
  const ids = new Set<string>([params.workflowRunId])

  if (params.ticketId) {
    const { data: byEntity } = await supabase
      .from("workflow_runs")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .in("template_id", ["maintenance_request", "maintenance_intake"])
      .eq("entity_type", "maintenance_request")
      .eq("entity_id", params.ticketId)

    for (const row of byEntity ?? []) {
      const id = asUuid(row.id)
      if (id) ids.add(id)
    }

    const { data: byMeta } = await supabase
      .from("workflow_runs")
      .select("id, metadata")
      .eq("landlord_id", params.landlordId)
      .in("template_id", ["maintenance_request", "maintenance_intake"])

    for (const row of byMeta ?? []) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>
      const linked =
        metaString(meta, "maintenance_request_id") ||
        metaString(meta, "draft_ticket_id")
      if (linked === params.ticketId) {
        const id = asUuid(row.id)
        if (id) ids.add(id)
      }
    }
  }

  return [...ids]
}

async function bestEffortRemoveStorage(
  supabase: SupabaseClient,
  paths: unknown,
): Promise<void> {
  if (!Array.isArray(paths) || paths.length === 0) return
  const clean = paths
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim())
  if (clean.length === 0) return
  const { error } = await supabase.storage
    .from("maintenance-uploads")
    .remove(clean)
  if (error) {
    console.warn("[admin-delete-work-order] storage remove", error.message)
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error("[admin-delete-work-order] ADMIN_REASSIGN_SECRET not set")
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  if (!adminReassignSecretAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

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
      { error: "Only maintenance work orders can be permanently deleted here" },
      400,
    )
  }

  const meta = (run.metadata ?? {}) as Record<string, unknown>
  let ticketId =
    bodyTicketId ||
    (String(run.entity_type ?? "") === "maintenance_request"
      ? asUuid(run.entity_id)
      : null) ||
    metaString(meta, "maintenance_request_id") ||
    metaString(meta, "draft_ticket_id")

  if (ticketId) {
    const { data: ticket, error: ticketErr } = await supabase
      .from("maintenance_requests")
      .select("id, landlord_id, photo_paths, completion_photo_paths")
      .eq("id", ticketId)
      .maybeSingle()

    if (ticketErr) {
      console.error("[admin-delete-work-order] load ticket", ticketErr.message)
      return jsonResponse({ error: "Load ticket failed" }, 500)
    }
    if (ticket && String(ticket.landlord_id) !== landlordId) {
      return jsonResponse({ error: "Forbidden" }, 403)
    }
    if (!ticket) {
      // Ticket already gone — still purge runs.
      ticketId = ticketId
    } else {
      await bestEffortRemoveStorage(supabase, ticket.photo_paths)
      await bestEffortRemoveStorage(supabase, ticket.completion_photo_paths)
    }
  }

  const runIds = await collectMaintenanceRunIds(supabase, {
    landlordId,
    workflowRunId,
    ticketId,
  })

  // Graph history for this WO (permanent delete = no tombstone).
  if (ticketId) {
    await supabase
      .from("operations_graph_events")
      .delete()
      .eq("landlord_id", landlordId)
      .eq("maintenance_request_id", ticketId)
  }

  if (runIds.length > 0) {
    await supabase
      .from("operations_graph_events")
      .delete()
      .eq("landlord_id", landlordId)
      .in("workflow_run_id", runIds)

    await supabase
      .from("property_operations_graph")
      .delete()
      .eq("landlord_id", landlordId)
      .in("workflow_run_id", runIds)

    // workflow_events cascade with runs
    const { error: runsErr } = await supabase
      .from("workflow_runs")
      .delete()
      .eq("landlord_id", landlordId)
      .in("id", runIds)

    if (runsErr) {
      console.error("[admin-delete-work-order] delete runs", runsErr.message)
      return jsonResponse({ error: runsErr.message }, 500)
    }
  }

  if (ticketId) {
    // Cascades invoices / estimates / feedback / notification logs.
    const { error: ticketDelErr } = await supabase
      .from("maintenance_requests")
      .delete()
      .eq("landlord_id", landlordId)
      .eq("id", ticketId)

    if (ticketDelErr) {
      console.error("[admin-delete-work-order] delete ticket", ticketDelErr.message)
      return jsonResponse({ error: ticketDelErr.message }, 500)
    }
  }

  return jsonResponse({
    ok: true,
    workflowRunId,
    maintenanceRequestId: ticketId,
    deletedRunIds: runIds,
  })
})
