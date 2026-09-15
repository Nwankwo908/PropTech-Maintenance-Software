import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { resolveLandlordId } from "../_shared/sms/landlordSmsOnboarding.ts"
import {
  abortFailedVendorOnboardingInvite,
  completeVendorOnboardingAfterOverride,
  startVendorOnboardingRun,
} from "../_shared/engine/vendorOnboardingProgress.ts"
import { findLandlordVendorByContact } from "../_shared/vendor_verification/findVendor.ts"
import {
  deliverVendorInvite,
  vendorInviteFailureUserMessage,
} from "../_shared/vendor_verification/deliverVendorInvite.ts"
import { sendVendorOnboardingOverrideActivatedSms } from "../_shared/sms/vendorOnboardingOverrideSms.ts"
import { dispatchUnassignedTicketsAfterOverride } from "../_shared/vendorOnboardingOverrideDispatch.ts"

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
  const adminAuth = requireAdminReassignAuth(req, "[send-vendor-invite]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: {
    action?: string
    landlordId?: string
    vendorId?: string | null
    ticketId?: string
    businessName?: string
    contactName?: string
    vendorFirstName?: string
    email?: string
    phone?: string
    propertyName?: string
    channel?: string
    tradeCategories?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  let landlordId: string
  try {
    landlordId = resolveLandlordId(body.landlordId)
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    )
  }

  const action = typeof body.action === "string" ? body.action.trim() : ""
  if (action === "retry_vendor_assignment") {
    const ticketId =
      typeof body.ticketId === "string" && body.ticketId.trim()
        ? body.ticketId.trim()
        : ""
    if (!ticketId) {
      return jsonResponse({ error: "Provide a work order to assign." }, 400)
    }
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select(
        "id, priority, unit, description, due_at, estimated_minutes, resident_availability_text, assigned_vendor_id, vendor_work_status",
      )
      .eq("id", ticketId)
      .eq("landlord_id", landlordId)
      .maybeSingle()
    if (!ticket?.id) {
      return jsonResponse({ error: "Work order not found." }, 404)
    }

    const assignedId =
      typeof ticket.assigned_vendor_id === "string" && ticket.assigned_vendor_id.trim()
        ? ticket.assigned_vendor_id.trim()
        : ""
    const workStatus =
      typeof ticket.vendor_work_status === "string"
        ? ticket.vendor_work_status.trim().toLowerCase()
        : ""
    if (assignedId && workStatus !== "pending_accept" && workStatus !== "unassigned") {
      return jsonResponse({
        error: "This work order already has a vendor in progress. Unassign from the dashboard first.",
      }, 409)
    }
    if (assignedId) {
      const { data: previous } = await supabase
        .from("vendors")
        .select("id, name, phone")
        .eq("id", assignedId)
        .maybeSingle()
      const { formatWorkOrderRef } = await import("../_shared/vendor_outreach_copy.ts")
      const { sendVendorJobAlert } = await import("../_shared/sms/vendorSmsRouting.ts")
      const vendorName =
        typeof previous?.name === "string" && previous.name.trim()
          ? previous.name.trim()
          : "there"
      const vendorPhone =
        typeof previous?.phone === "string" ? previous.phone.trim() : ""
      if (vendorPhone) {
        await sendVendorJobAlert(supabase, {
          ticketId,
          vendorId: assignedId,
          vendorPhone,
          landlordId,
          body: [
            `Hi ${vendorName},`,
            "",
            "This is the property management team.",
            "",
            `Please hold on work order ${formatWorkOrderRef(ticketId)}. The property team is still deciding who should take this job. We'll text you if it is assigned to you.`,
          ].join("\n"),
        })
      }
      await supabase
        .from("maintenance_requests")
        .update({
          assigned_vendor_id: null,
          assigned_at: null,
          vendor_action_token: null,
          vendor_work_status: "unassigned",
          vendor_notified_at: null,
          vendor_notify_error: null,
        })
        .eq("id", ticketId)
        .eq("landlord_id", landlordId)
    }

    const { assignVendorAndNotify } = await import(
      "../submit-maintenance-request/vendor_notify.ts"
    )
    const result = await assignVendorAndNotify(supabase, {
      ticketId,
      priority: typeof ticket.priority === "string" && ticket.priority.trim()
        ? ticket.priority
        : "normal",
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
      description: typeof ticket.description === "string" ? ticket.description : "",
      dueAt: typeof ticket.due_at === "string" ? ticket.due_at : null,
      estimatedMinutes: typeof ticket.estimated_minutes === "number"
        ? ticket.estimated_minutes
        : null,
      landlordId,
      residentAvailabilityText:
        typeof ticket.resident_availability_text === "string"
          ? ticket.resident_availability_text
          : null,
      retryIfUnassigned: true,
      refreshLandlordChoice: true,
    })
    return jsonResponse({
      ok: true,
      assigned: result.assigned,
      vendorId: result.vendorId,
      skipReason: result.skipReason ?? null,
    })
  }
  if (
    action === "notify_override_activated" ||
    action === "dispatch_override_jobs"
  ) {
    const vendorId =
      typeof body.vendorId === "string" && body.vendorId.trim()
        ? body.vendorId.trim()
        : ""
    if (!vendorId) {
      return jsonResponse({ error: "Provide a vendor to notify." }, 400)
    }
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    let sms: "sent" | "skipped" | "failed" = "skipped"
    if (action === "notify_override_activated") {
      const result = await sendVendorOnboardingOverrideActivatedSms(supabase, {
        landlordId,
        vendorId,
      })
      sms = result.sms
    }
    const dispatched = await dispatchUnassignedTicketsAfterOverride(supabase, {
      landlordId,
      vendorId,
    })
    await completeVendorOnboardingAfterOverride(supabase, {
      landlordId,
      vendorId,
    })
    return jsonResponse({
      ok: true,
      sms,
      assignedCount: dispatched.assignedCount,
    })
  }

  const businessName = typeof body.businessName === "string"
    ? body.businessName.trim()
    : ""
  const contactName = typeof body.contactName === "string"
    ? body.contactName.trim()
    : ""
  const vendorFirstName = typeof body.vendorFirstName === "string"
    ? body.vendorFirstName.trim()
    : (contactName.split(/\s+/)[0] ?? "")
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const phone = typeof body.phone === "string" ? body.phone.trim() : ""
  const propertyName = typeof body.propertyName === "string"
    ? body.propertyName.trim()
    : ""
  const requestedVendorId =
    typeof body.vendorId === "string" && body.vendorId.trim()
      ? body.vendorId.trim()
      : null
  const tradeCategories = Array.isArray(body.tradeCategories)
    ? body.tradeCategories.filter((t): t is string => typeof t === "string")
    : []

  const channelRaw = (typeof body.channel === "string" ? body.channel : "both")
    .toLowerCase()
  const channel = ["sms", "email", "both"].includes(channelRaw)
    ? channelRaw
    : "both"

  if (!businessName && !contactName) {
    return jsonResponse(
      { error: "Provide a business name or contact name" },
      400,
    )
  }
  if (!email && !phone) {
    return jsonResponse({ error: "Provide an email or phone to send the invite" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const vendorId = await findLandlordVendorByContact(supabase, landlordId, {
      vendorId: requestedVendorId,
      email: email || null,
      phone: phone || null,
    })

    const vendorName = businessName || vendorFirstName || contactName || null
    let companyName: string | null = null
    {
      const { data: landlordRow } = await supabase
        .from("landlords")
        .select("name")
        .eq("id", landlordId)
        .maybeSingle()
      const name = typeof landlordRow?.name === "string" ? landlordRow.name.trim() : ""
      companyName = name || null
    }

    const run = await startVendorOnboardingRun(supabase, {
      landlordId,
      vendorId,
      triggerType: "dashboard",
      channel,
      businessName: businessName || null,
      contactName: contactName || null,
    })
    const workflowRunId = run?.id ?? null
    if (!workflowRunId) {
      console.error("[send-vendor-invite] workflow run was not created; sending invite anyway")
    }

    const delivered = await deliverVendorInvite(supabase, {
      landlordId,
      workflowRunId,
      vendorId,
      businessName: businessName || null,
      contactName: contactName || null,
      vendorFirstName: vendorFirstName || null,
      email: email || null,
      phone: phone || null,
      propertyName: propertyName || null,
      channel,
      tradeCategories,
      vendorName,
      companyName,
    })

    if (!delivered?.anyDelivered) {
      if (workflowRunId) {
        await abortFailedVendorOnboardingInvite(supabase, {
          runId: workflowRunId,
          landlordId,
          vendorId,
          vendorLabel: vendorName || "vendor",
          verificationId: delivered?.verificationId || null,
          delivery: delivered?.delivery ?? null,
        })
      }
      return jsonResponse(
        {
          error: vendorInviteFailureUserMessage(delivered?.delivery ?? null),
          delivery: delivered?.delivery ?? null,
        },
        422,
      )
    }

    return jsonResponse({
      ok: true,
      verificationId: delivered.verificationId,
      token: delivered.token,
      link: delivered.link,
      workflowRunId,
      delivery: delivered.delivery,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[send-vendor-invite] failed", message)
    return jsonResponse(
      {
        error: "We couldn't start vendor onboarding. Please try again in a moment.",
      },
      500,
    )
  }
})
