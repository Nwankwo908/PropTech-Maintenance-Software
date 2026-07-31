/**
 * Scheduled job:
 * 1. Tickets past due_at → auto-reassign to next roster vendor (or escalate if none).
 * 2. pending_accept 48h+ with no response → reassign via alternatives (legacy path).
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { processSlaExpiredAutoReassign } from "../_shared/sla_expired_auto_reassign.ts"
import { runMaintenanceRequestViaEngine } from "../_shared/engine/maintenanceRequestEngine.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function authorizedCronOrAdmin(req: Request): boolean {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  const t = h.slice(7).trim()
  const cron = Deno.env.get("VENDOR_DELAY_CRON_SECRET")?.trim()
  if (cron && t === cron) return true
  const admin = Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()
  return Boolean(admin && t === admin)
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!authorizedCronOrAdmin(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const slaResults = await processSlaExpiredAutoReassign(supabase)

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: stale, error: qErr } = await supabase
    .from("maintenance_requests")
    .select("id")
    .eq("vendor_work_status", "pending_accept")
    .not("assigned_vendor_id", "is", null)
    .not("assigned_at", "is", null)
    .lt("assigned_at", cutoff)
    .limit(50)

  if (qErr) {
    console.error("[vendor-delayed-auto-reassign] query", qErr)
    return jsonResponse({ error: "Query failed" }, 500)
  }

  const delayedResults: { ticketId: string; ok?: boolean; error?: string }[] = []

  for (const row of stale ?? []) {
    const ticketId = String(row.id ?? "")
    if (!ticketId) continue

    const { data: ticketRow } = await supabase
      .from("maintenance_requests")
      .select("landlord_id, assigned_vendor_id, issue_category")
      .eq("id", ticketId)
      .maybeSingle()

    const landlordId = ticketRow?.landlord_id == null
      ? null
      : String(ticketRow.landlord_id).trim()

    if (!landlordId) {
      delayedResults.push({ ticketId, error: "Missing landlord" })
      continue
    }

    const engineResult = await runMaintenanceRequestViaEngine(supabase, {
      landlordId,
      trigger: "automation",
      maintenanceRequest: {
        action: "auto_reassign",
        autoReassign: {
          ticketId,
          trigger: "pending_accept_stale",
          landlordId,
          assignedVendorId: ticketRow?.assigned_vendor_id == null
            ? null
            : String(ticketRow.assigned_vendor_id),
          issueCategory: ticketRow?.issue_category == null
            ? null
            : String(ticketRow.issue_category),
          previousVendorId: ticketRow?.assigned_vendor_id == null
            ? null
            : String(ticketRow.assigned_vendor_id),
          findStrategy: "recommend_ranked",
        },
      },
    })

    const meta = engineResult?.metadata ?? {}
    const outcome = meta.outcome as string | undefined

    if (outcome === "reassigned") {
      delayedResults.push({ ticketId, ok: true })
    } else if (outcome === "needs_admin_vendor") {
      delayedResults.push({
        ticketId,
        error: "No alternative vendors — escalated for admin",
      })
    } else {
      delayedResults.push({
        ticketId,
        error: String(meta.reason ?? "Auto-reassign skipped"),
      })
    }
  }

  return jsonResponse({
    ok: true,
    slaExpired: slaResults,
    delayedPendingAccept: {
      cutoff,
      processed: delayedResults.length,
      results: delayedResults,
    },
  })
})
