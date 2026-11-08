/**
 * Admin/ops remediation: ensure a maintenance_request workflow run exists for a
 * ticket, optionally text the resident a close-the-loop update, then run normal
 * confirmed dispatch (vendor probe / landlord choice / nearby search).
 *
 * Also supports resurfacing landlord assign_vendor attention (SMS/email) after
 * a stale pending_accept sticky needs_admin clear — runs with edge secrets.
 *
 * `action: "landlord_vendor_choice_ask"` texts the landlord choice SMS only
 * (eligibility rules intact). No resident SMS, no vendor probe, no assignment.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { recordActivityLog } from "../_shared/graph/recordActivityLog.ts"
import { loadLandlordMarketplacePreference } from "../_shared/landlordNotificationPrefs.ts"
import {
  buildOrphanTicketCloseLoopSms,
  remediateOrphanedMaintenanceTicket,
} from "../_shared/maintenanceTicketRemediation.ts"
import { resurfaceAssignVendorAttentionForTicket } from "../_shared/remediateStaleNeedsAdminPendingAccept.ts"
import {
  loadJobStateForTicket,
  loadMostRecentlyAssignedVendorId,
  resolveVendorAssignmentDecision,
} from "../_shared/vendor_assignment.ts"
import {
  markAwaitingLandlordVendorChoice,
  notifyLandlordVendorChoice,
} from "../_shared/vendorLandlordChoice.ts"

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

  if (action === "landlord_vendor_choice_ask") {
    const { data: ticket, error: ticketErr } = await supabase
      .from("maintenance_requests")
      .select(
        "id, display_id, landlord_id, unit, issue_category, issue_headline, description, assigned_vendor_id, vendor_work_status, awaiting_landlord_choice_at",
      )
      .eq("id", ticketId)
      .maybeSingle()
    if (ticketErr || !ticket?.id) {
      return jsonResponse({ ok: false, error: "not_found" }, 404)
    }
    const landlordId =
      typeof ticket.landlord_id === "string" ? ticket.landlord_id.trim() : ""
    if (!landlordId) {
      return jsonResponse({ ok: false, error: "missing_landlord" }, 400)
    }
    if (
      typeof ticket.assigned_vendor_id === "string" &&
      ticket.assigned_vendor_id.trim()
    ) {
      return jsonResponse({
        ok: false,
        error: "already_assigned",
        assigned_vendor_id: ticket.assigned_vendor_id,
      }, 409)
    }

    const issueCategory =
      typeof ticket.issue_category === "string" && ticket.issue_category.trim()
        ? ticket.issue_category.trim()
        : null
    const unit = typeof ticket.unit === "string" ? ticket.unit : ""
    const preferNot = await loadMostRecentlyAssignedVendorId(supabase)
    const marketplacePreference = await loadLandlordMarketplacePreference(
      supabase,
      landlordId,
    )
    const jobState = await loadJobStateForTicket(supabase, {
      ticketId,
      landlordId,
    })
    const decision = await resolveVendorAssignmentDecision(supabase, {
      issueCategory,
      excludeVendorIds: [],
      preferNotVendorId: preferNot,
      landlordId,
      marketplacePreference,
      jobState,
    })
    if (decision.kind !== "landlord_choice" || decision.options.length === 0) {
      return jsonResponse({
        ok: false,
        error: "no_eligible_vendors",
        ticket_id: ticketId,
        landlord_id: landlordId,
      }, 422)
    }

    const notified = await notifyLandlordVendorChoice(supabase, {
      landlordId,
      ticketId,
      unit,
      issueCategory,
      options: decision.options,
      issueHeadline:
        typeof ticket.issue_headline === "string" ? ticket.issue_headline : null,
    })
    await markAwaitingLandlordVendorChoice(supabase, ticketId)

    try {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "maintenance.confirmed_dispatch_landlord_ask",
        source: "edge_function",
        actorType: "system",
        maintenanceRequestId: ticketId,
        metadata: {
          message:
            "Asked the landlord to approve a vendor before any vendor contact.",
          display_id: ticket.display_id ?? null,
          option_ids: decision.options.map((row) => row.vendor.id),
          option_names: decision.options.map((row) => row.vendor.name),
          sms_sent: notified.sent,
          resident_sms_skipped: true,
          vendor_probe_skipped: true,
        },
      })
    } catch (e) {
      console.error("[remediate-maintenance-ticket] landlord ask log", e)
    }

    return jsonResponse({
      ok: true,
      action,
      ticket_id: ticketId,
      landlord_id: landlordId,
      sms_sent: notified.sent,
      option_count: decision.options.length,
      option_ids: decision.options.map((row) => row.vendor.id),
      option_names: decision.options.map((row) => row.vendor.name),
      vendor_probe_skipped: true,
      resident_sms_skipped: true,
      vendor_assigned: false,
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
