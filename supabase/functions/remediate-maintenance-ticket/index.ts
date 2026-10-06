/**
 * Admin/ops remediation: ensure a maintenance_request workflow run exists for a
 * ticket, optionally text the resident a close-the-loop update, then run normal
 * confirmed dispatch (vendor probe / landlord choice / nearby search).
 *
 * Also supports resurfacing landlord assign_vendor attention (SMS/email) after
 * a stale pending_accept sticky needs_admin clear — runs with edge secrets.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import {
  buildOrphanTicketCloseLoopSms,
  remediateOrphanedMaintenanceTicket,
} from "../_shared/maintenanceTicketRemediation.ts"
import { resurfaceAssignVendorAttentionForTicket } from "../_shared/remediateStaleNeedsAdminPendingAccept.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  const auth = requireAdminReassignAuth(
    req,
    "[remediate-maintenance-ticket]",
    corsHeaders,
  )
  if (!auth.ok) return auth.response

  let body: {
    ticket_id?: string
    action?: string
    resident_close_loop_sms?: string | null
    skip_resident_sms?: boolean
    skip_dispatch?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id.trim() : ""
  if (!ticketId || !uuidRe.test(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticket_id" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  const action = (body.action ?? "orphan").trim().toLowerCase()
  if (action === "resurface_assign_vendor_attention") {
    const result = await resurfaceAssignVendorAttentionForTicket(supabase, ticketId, {
      reasonTag: "edge_resurface",
    })
    if (!result.ok) {
      return jsonResponse(result, result.error === "not_found" ? 404 : 500)
    }
    return jsonResponse({
      ok: true,
      action,
      ticket_id: ticketId,
      landlord_id: result.landlordId,
      attention: {
        skipped: result.attention.skipped,
        sms_sent: result.attention.smsSent,
        email_sent: result.attention.emailSent,
        errors: result.attention.errors,
      },
    })
  }

  let closeLoop: string | null = null
  if (body.skip_resident_sms !== true) {
    if (
      typeof body.resident_close_loop_sms === "string" &&
      body.resident_close_loop_sms.trim()
    ) {
      closeLoop = body.resident_close_loop_sms.trim()
    } else {
      const { data: ticket } = await supabase
        .from("maintenance_requests")
        .select("resident_name, issue_headline, issue_category, description")
        .eq("id", ticketId)
        .maybeSingle()
      const desc = String(ticket?.description ?? "")
      const headline = String(ticket?.issue_headline ?? "").trim()
      const genericHeadline =
        !headline ||
        /^(appliance|maintenance|repair)\s+issue$/i.test(headline)
      const issueLabel = /oven|stove/i.test(desc)
        ? "the oven"
        : !genericHeadline
        ? headline.replace(/^an?\s+/i, "").replace(/\.$/, "")
        : ticket?.issue_category === "appliance_repair"
        ? "the appliance"
        : "the repair"
      closeLoop = buildOrphanTicketCloseLoopSms({
        residentName: ticket?.resident_name,
        issueLabel,
      })
    }
  }

  const result = await remediateOrphanedMaintenanceTicket(supabase, {
    ticketId,
    residentCloseLoopSms: closeLoop,
    skipDispatch: body.skip_dispatch === true,
  })

  if (!result.ok) {
    return jsonResponse(result, 500)
  }
  return jsonResponse(result)
})
