import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import { reassignVendorByIdAndNotify } from "../submit-maintenance-request/vendor_notify.ts"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"
import { resolveLandlordId } from "../_shared/sms/landlordSmsOnboarding.ts"
import { beginVendorAvailabilityAsk } from "../_shared/vendor_job_schedule.ts"
import {
  buildVendorScheduleConfirmedSms,
  formatWorkOrderRef,
} from "../_shared/vendor_outreach_copy.ts"
import { sendVendorJobAlert } from "../_shared/sms/vendorSmsRouting.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"

function appBaseUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() ?? ""
  if (!raw) return "https://www.ulohome.io"
  const t = raw.replace(/\/$/, "")
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

const corsHeaders = adminEdgeCorsHeaders

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

  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error("[admin-reassign-vendor] ADMIN_REASSIGN_SECRET not set")
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  if (!adminReassignSecretAuthorized(req)) {
    console.warn(
      "[admin-reassign-vendor] 401 Unauthorized: x-admin-reassign-secret (or legacy Bearer admin secret) does not match ADMIN_REASSIGN_SECRET on this deployment",
    )
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: {
    action?: string
    ticketId?: string
    vendorId?: string
    vendorName?: string
    createVendorIfMissing?: boolean
    vendorCategory?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  const action =
    typeof body.action === "string" ? body.action.trim().toLowerCase() : ""
  const vendorIdRaw =
    typeof body.vendorId === "string" ? body.vendorId.trim() : ""
  const vendorName =
    typeof body.vendorName === "string" ? body.vendorName.trim() : ""
  const createVendorIfMissing = body.createVendorIfMissing === true
  const vendorCategoryRaw =
    typeof body.vendorCategory === "string" ? body.vendorCategory.trim() : ""
  const vendorCategoryInsert = vendorCategoryRaw || null

  if (!ticketId || !isUuidShape(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
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

  const { data: ticketRow, error: ticketLoadErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, issue_category, assigned_vendor_id, vendor_work_status, scheduled_window_text, vendor_action_token",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (ticketLoadErr) {
    console.error("[admin-reassign-vendor] load ticket scope", ticketLoadErr)
    return jsonResponse({ error: "Load ticket failed" }, 500)
  }
  if (!ticketRow) {
    return jsonResponse({ error: "Ticket not found" }, 404)
  }

  const ticketLandlordId = ticketRow.landlord_id == null
    ? null
    : String(ticketRow.landlord_id).trim()
  const ticketIssueCategory = ticketRow.issue_category == null
    ? null
    : String(ticketRow.issue_category).trim()

  // Ops heal: resend "Earliest availability?" after accept when the ask SMS failed.
  if (action === "ask_availability") {
    const assignedVendorId =
      typeof ticketRow.assigned_vendor_id === "string"
        ? ticketRow.assigned_vendor_id.trim()
        : ""
    if (!assignedVendorId) {
      return jsonResponse({ error: "Ticket has no assigned vendor" }, 422)
    }
    try {
      const ask = await beginVendorAvailabilityAsk(supabase, {
        ticketId,
        vendorId: assignedVendorId,
      })
      return jsonResponse({
        ok: ask.sentSms,
        ticketId,
        assigned_vendor_id: assignedVendorId,
        sentSms: ask.sentSms,
        conversationId: ask.conversationId,
        vendor_work_status: ticketRow.vendor_work_status ?? null,
      }, ask.sentSms ? 200 : 502)
    } catch (e) {
      console.error("[admin-reassign-vendor] ask_availability", e)
      return jsonResponse({ error: "Availability ask failed" }, 500)
    }
  }

  // Ops heal: schedule was saved but confirm SMS was circuit-breaker suppressed.
  if (action === "schedule_confirm") {
    const assignedVendorId =
      typeof ticketRow.assigned_vendor_id === "string"
        ? ticketRow.assigned_vendor_id.trim()
        : ""
    if (!assignedVendorId) {
      return jsonResponse({ error: "Ticket has no assigned vendor" }, 422)
    }
    const { data: vendor } = await supabase
      .from("vendors")
      .select("phone")
      .eq("id", assignedVendorId)
      .maybeSingle()
    const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
    if (!phone) {
      return jsonResponse({ error: "Vendor has no phone" }, 422)
    }
    const windowText =
      (typeof ticketRow.scheduled_window_text === "string" &&
          ticketRow.scheduled_window_text.trim()) ||
        "the agreed time"
    const token =
      typeof ticketRow.vendor_action_token === "string"
        ? ticketRow.vendor_action_token.trim()
        : ""
    const jobDetailUrl = token
      ? `${appBaseUrl()}/w/${encodeURIComponent(token)}`
      : ""
    const body = buildVendorScheduleConfirmedSms({
      workOrderRef: formatWorkOrderRef(ticketId),
      windowText,
      jobDetailUrl,
    })
    try {
      const send = await sendVendorJobAlert(supabase, {
        ticketId,
        vendorId: assignedVendorId,
        vendorPhone: phone,
        body,
        landlordId: ticketLandlordId,
      })
      return jsonResponse({
        ok: send.ok,
        ticketId,
        sentSms: send.ok,
        conversationId: send.ok ? send.conversationId : null,
        error: send.ok ? undefined : send.error,
      }, send.ok ? 200 : 502)
    } catch (e) {
      console.error("[admin-reassign-vendor] schedule_confirm", e)
      return jsonResponse({ error: "Schedule confirm SMS failed" }, 500)
    }
  }

  let _vendorId = ""
  if (vendorIdRaw && isUuidShape(vendorIdRaw)) {
    _vendorId = vendorIdRaw
  } else if (vendorName) {
    const needle = vendorName
      .trim()
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
    let vendorQuery = supabase
      .from("vendors")
      .select("id, name")
      .eq("active", true)
      .ilike("name", needle)
      .limit(25)
    if (ticketLandlordId) {
      vendorQuery = vendorQuery.eq("landlord_id", ticketLandlordId)
    }
    const { data: rows, error: exErr } = await vendorQuery

    if (exErr) {
      console.error("[admin-reassign-vendor] vendor by name", exErr)
      return jsonResponse({ error: "Vendor lookup failed" }, 500)
    }
    const norm = (s: string) => s.trim().toLowerCase()
    const want = norm(vendorName)
    const matches = (rows ?? []).filter((r) => norm(r.name as string) === want)
    if (matches.length === 0) {
      if (createVendorIfMissing) {
        const insertRow: Record<string, unknown> = {
          name: vendorName,
          category: vendorCategoryInsert ?? ticketIssueCategory,
          active: true,
          notification_channel: "email",
        }
        if (ticketLandlordId) insertRow.landlord_id = ticketLandlordId
        const { data: ins, error: insErr } = await supabase
          .from("vendors")
          .insert(insertRow)
          .select("id")
          .single()
        if (insErr || !ins?.id) {
          console.error("[admin-reassign-vendor] create vendor", insErr)
          return jsonResponse({ error: "Could not create vendor record" }, 500)
        }
        _vendorId = ins.id as string
      } else {
        return jsonResponse(
          { error: `No active vendor found named "${vendorName}"` },
          404,
        )
      }
    } else if (matches.length > 1) {
      return jsonResponse(
        {
          error:
            "Multiple vendors match that name; use vendorId (uuid) instead",
        },
        409,
      )
    } else {
      _vendorId = matches[0].id as string
    }
  } else {
    return jsonResponse(
      { error: "Provide vendorId (uuid) or vendorName" },
      400,
    )
  }

  const result = await reassignVendorByIdAndNotify(supabase, ticketId, _vendorId)
  // Plan: resident `vendor_assigned` email/SMS is sent inside reassignVendorByIdAndNotify (notifyResidentVendorAssigned).
  if ("error" in result) {
    const status =
      result.error === "Ticket not found"
        ? 404
        : result.error.includes("Vendor not")
          ? 404
          : 500
    return jsonResponse({ error: result.error }, status)
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: ticketLandlordId ?? resolveLandlordId(),
      event_type: "vendor.reassigned",
      source: "dashboard",
      actor_type: "landlord",
      vendor_id: _vendorId,
      maintenance_request_id: ticketId,
      metadata: {
        vendor_name: vendorName || null,
        create_vendor_if_missing: createVendorIfMissing,
      },
    })
  } catch (e) {
    console.error("[admin-reassign-vendor] graph event", e)
  }

  return jsonResponse({ ok: true, ticketId, assigned_vendor_id: _vendorId })
})
