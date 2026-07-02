/**
 * Scheduled job:
 * 1. Tickets past due_at → auto-reassign to next roster vendor (or escalate if none).
 * 2. pending_accept 48h+ with no response → reassign via alternatives (legacy path).
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recommendAlternativeVendorsForTicket } from "../_shared/recommend_vendor_alternatives.ts"
import { processSlaExpiredAutoReassign, escalateForNoVendor } from "../_shared/sla_expired_auto_reassign.ts"
import { reassignVendorByIdAndNotify } from "../submit-maintenance-request/vendor_notify.ts"

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

    const rec = await recommendAlternativeVendorsForTicket(supabase, ticketId, {
      limit: 3,
    })
    if ("error" in rec) {
      delayedResults.push({ ticketId, error: rec.error })
      continue
    }
    const pick = rec.alternatives[0]
    if (!pick) {
      const { data: ticketRow } = await supabase
        .from("maintenance_requests")
        .select("id, landlord_id, assigned_vendor_id, issue_category, vendor_work_status")
        .eq("id", ticketId)
        .maybeSingle()
      if (ticketRow) {
        await escalateForNoVendor(supabase, {
          id: ticketId,
          landlord_id: ticketRow.landlord_id == null ? null : String(ticketRow.landlord_id),
          assigned_vendor_id: ticketRow.assigned_vendor_id == null
            ? null
            : String(ticketRow.assigned_vendor_id),
          issue_category: ticketRow.issue_category == null
            ? null
            : String(ticketRow.issue_category),
          vendor_work_status: String(ticketRow.vendor_work_status ?? "").toLowerCase(),
        })
      }
      delayedResults.push({ ticketId, error: "No alternative vendors — escalated for admin" })
      continue
    }

    const r = await reassignVendorByIdAndNotify(supabase, ticketId, pick.id, {
      eventSource: "auto_reassign",
    })
    if ("error" in r) {
      delayedResults.push({ ticketId, error: r.error })
    } else {
      delayedResults.push({ ticketId, ok: true })
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
