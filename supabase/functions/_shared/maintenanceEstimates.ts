/**
 * Vendor estimate submit + landlord 1-tap approve/reject (Phase 3 / 4.3).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "./delivery.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import {
  findActiveLandlordMainNumber,
  resolveLandlordId,
} from "./sms/landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { getSMSProvider } from "./sms/providerFactory.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"
import {
  appendEstimateDecisionStatusToVendorThread,
  appendMaintenanceEstimateSubmittedToInbox,
  resolveVendorJobConversationId,
} from "./sms/maintenanceEstimateInbox.ts"
import {
  buildEstimateDecisionStatusSms,
  vendorJobDecisionFromWorkStatus,
} from "./sms/workOrderAdminStatusSms.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"

export type EstimateMoneyInput = {
  partsCost: number
  laborCost: number
  totalCost?: number | null
  notes?: string | null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function appBaseUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() ?? ""
  if (!raw) return ""
  const t = raw.replace(/\/$/, "")
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function respondFnBase(): string {
  const explicit = Deno.env.get("LANDLORD_ESTIMATE_RESPOND_FN_URL")?.trim()?.replace(
    /\/$/,
    "",
  )
  if (explicit) return explicit
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()?.replace(/\/$/, "") ?? ""
  if (!supabaseUrl) return ""
  return `${supabaseUrl}/functions/v1/landlord-respond-estimate`
}

function adminNotifyEmails(): string[] {
  const raw = Deno.env.get("SMS_ADMIN_NOTIFY_EMAILS")?.trim()
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((e: string) => e.trim())
    .filter((e: string) => e.includes("@"))
}

function adminNotifyPhones(): string[] {
  const raw =
    Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ||
    Deno.env.get("LANDLORD_OPS_PHONE")?.trim() ||
    ""
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((p: string) => normalizePhoneFlexible(p))
    .filter((p): p is string => Boolean(p))
}

export function normalizeEstimateMoney(
  input: EstimateMoneyInput,
): { partsCost: number; laborCost: number; totalCost: number } | { error: string } {
  const parts = Number(input.partsCost)
  const labor = Number(input.laborCost)
  if (!Number.isFinite(parts) || parts < 0) {
    return { error: "Parts cost must be a non-negative number" }
  }
  if (!Number.isFinite(labor) || labor < 0) {
    return { error: "Labor cost must be a non-negative number" }
  }
  let total =
    input.totalCost == null || input.totalCost === undefined
      ? parts + labor
      : Number(input.totalCost)
  if (!Number.isFinite(total) || total < 0) {
    return { error: "Total must be a non-negative number" }
  }
  const partsR = roundMoney(parts)
  const laborR = roundMoney(labor)
  const totalR = roundMoney(total)
  if (totalR <= 0) {
    return { error: "Total must be greater than zero" }
  }
  return { partsCost: partsR, laborCost: laborR, totalCost: totalR }
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

async function persistLandlordEstimateNotifySms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    phone: string
    body: string
    estimateId: string
    actionToken: string
    ticketId: string
    providerMessageSid: string
    provider: string
    fromNumber: string
  },
): Promise<void> {
  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.phone,
    identityType: "landlord",
  })
  if (!identity) return

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!main?.id) return

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: main.id,
    externalPhone: params.phone,
    identity,
    maintenanceRequestId: params.ticketId,
    conversationStatus: "open",
  })

  await supabase.from("sms_messages").insert({
    conversation_id: conversationId,
    landlord_id: params.landlordId,
    direction: "outbound",
    from_number: normalizeSmsPhone(params.fromNumber),
    to_number: normalizeSmsPhone(params.phone),
    body: params.body,
    media_urls: [],
    provider: params.provider,
    provider_message_sid: params.providerMessageSid,
    provider_status: "sent",
    raw_payload: {
      source: "landlord_estimate_notify",
      estimate_id: params.estimateId,
    },
  })

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const prior =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}

  await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      maintenance_request_id: params.ticketId,
      intake_state: {
        ...prior,
        awaiting_estimate_decision: {
          estimate_id: params.estimateId,
          action_token: params.actionToken,
          ticket_id: params.ticketId,
        },
      },
    })
    .eq("id", conversationId)
}

async function notifyLandlordEstimatePending(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    estimateId: string
    actionToken: string
    ticketId: string
    unit: string
    vendorName: string
    partsCost: number
    laborCost: number
    totalCost: number
    notes: string | null
  },
): Promise<void> {
  const wo = formatWorkOrderRef(params.ticketId)
  const respondBase = respondFnBase()
  const approveUrl = respondBase
    ? `${respondBase}?action=approve&estimateId=${encodeURIComponent(params.estimateId)}&token=${encodeURIComponent(params.actionToken)}`
    : null
  const rejectUrl = respondBase
    ? `${respondBase}?action=reject&estimateId=${encodeURIComponent(params.estimateId)}&token=${encodeURIComponent(params.actionToken)}`
    : null

  const smsLines = [
    `This is the property management team.`,
    "",
    `Estimate for ${wo}${params.unit ? ` (${params.unit})` : ""}.`,
    `${params.vendorName} submitted ${money(params.totalCost)} (parts ${money(params.partsCost)} · labor ${money(params.laborCost)}).`,
    "",
    "Reply APPROVE or DECLINE.",
  ]
  if (approveUrl) {
    smsLines.push("", `Or tap Approve: ${approveUrl}`)
    if (rejectUrl) smsLines.push(`Decline: ${rejectUrl}`)
  } else {
    smsLines.push("", "Or open the admin dashboard to review this estimate.")
  }
  const smsBody = smsLines.join("\n")

  const main = await findActiveLandlordMainNumber(supabase, params.landlordId)
  const provider = getSMSProvider()
  for (const phone of adminNotifyPhones()) {
    const sendResult = await provider.sendMessage({
      to: phone,
      body: smsBody,
      from: main?.phone_number,
    })
    if (sendResult.error) {
      console.error("[maintenance-estimates] landlord SMS", phone, sendResult.error)
      continue
    }
    try {
      await persistLandlordEstimateNotifySms(supabase, {
        landlordId: params.landlordId,
        phone,
        body: smsBody,
        estimateId: params.estimateId,
        actionToken: params.actionToken,
        ticketId: params.ticketId,
        providerMessageSid:
          sendResult.providerMessageSid ??
          sendResult.messageId ??
          `landlord-estimate:${params.estimateId}:${phone}`,
        provider: sendResult.provider ?? "twilio",
        fromNumber: main?.phone_number ?? "unknown",
      })
    } catch (e) {
      console.error("[maintenance-estimates] persist landlord SMS thread", e)
    }
  }

  const emails = new Set(adminNotifyEmails())
  const { data: landlord } = await supabase
    .from("landlords")
    .select("email")
    .eq("id", params.landlordId)
    .maybeSingle()
  if (typeof landlord?.email === "string" && landlord.email.includes("@")) {
    emails.add(landlord.email.trim())
  }

  const subject = `Approve estimate for ${wo}`
  const text = [
    `A vendor submitted an estimate for work order ${wo}.`,
    "",
    `Unit: ${params.unit || "—"}`,
    `Vendor: ${params.vendorName}`,
    `Parts: ${money(params.partsCost)}`,
    `Labor: ${money(params.laborCost)}`,
    `Total: ${money(params.totalCost)}`,
    params.notes ? `Notes: ${params.notes}` : null,
    "",
    approveUrl ? `Approve: ${approveUrl}` : null,
    rejectUrl ? `Decline: ${rejectUrl}` : null,
    "",
    "Reply APPROVE or DECLINE by text, or tap a link below — no login required.",
  ]
    .filter(Boolean)
    .join("\n")

  const html = `<p>A vendor submitted an estimate for work order <strong>${wo}</strong>.</p>
<ul>
<li><strong>Unit:</strong> ${params.unit || "—"}</li>
<li><strong>Vendor:</strong> ${params.vendorName}</li>
<li><strong>Parts:</strong> ${money(params.partsCost)}</li>
<li><strong>Labor:</strong> ${money(params.laborCost)}</li>
<li><strong>Total:</strong> ${money(params.totalCost)}</li>
</ul>
${params.notes ? `<p>Notes: ${params.notes}</p>` : ""}
${
    approveUrl
      ? `<p><a href="${approveUrl}" style="display:inline-block;padding:10px 16px;background:#186179;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Approve estimate</a></p>
<p><a href="${rejectUrl ?? "#"}">Decline estimate</a></p>`
      : "<p>Open the admin dashboard to review this estimate.</p>"
  }`

  for (const email of emails) {
    const result = await sendResendEmail(email, subject, text, html)
    if ("error" in result) {
      console.error("[maintenance-estimates] landlord email", email, result.error)
    }
  }
}

async function notifyVendorEstimateDecision(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    estimateId: string
    approved: boolean
    totalCost: number
    workOrderRef: string
  },
): Promise<void> {
  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, phone")
    .eq("id", params.vendorId)
    .maybeSingle()

  const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
  if (!phone) return

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("vendor_action_token, landlord_id, vendor_work_status")
    .eq("id", params.ticketId)
    .maybeSingle()

  const vendorDecision = vendorJobDecisionFromWorkStatus(
    typeof ticket?.vendor_work_status === "string"
      ? ticket.vendor_work_status
      : null,
  )
  // Declined vendors follow reassignment — do not send approval/continuation SMS.
  if (vendorDecision === "declined") {
    console.info("[maintenance-estimates] skip vendor decision SMS — job declined", {
      ticketId: params.ticketId,
      vendorId: params.vendorId,
    })
    return
  }

  const token =
    typeof ticket?.vendor_action_token === "string"
      ? ticket.vendor_action_token.trim()
      : ""
  const base = appBaseUrl()
  const jobLink =
    token && base
      ? `${base}/w/${encodeURIComponent(token)}`
      : token
        ? `/w/${encodeURIComponent(token)}`
        : null

  const vendorName =
    typeof vendor?.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "there"

  const body = buildEstimateDecisionStatusSms({
    vendorName,
    workOrderRef: params.workOrderRef,
    approved: params.approved,
    totalCost: params.totalCost,
    jobLink,
    vendorDecision,
  })
  if (!body) return

  const landlordId =
    typeof ticket?.landlord_id === "string" ? ticket.landlord_id : null

  const alertResult = await sendVendorJobAlert(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorPhone: phone,
    body,
    landlordId,
  })
  if (!alertResult.ok) {
    console.error(
      "[maintenance-estimates] vendor decision SMS failed",
      alertResult.error,
    )
  }

  // If SMS routing missed the ticket-linked vendor thread (or send failed),
  // mirror the same status copy there so admins see it next to the estimate.
  if (landlordId) {
    const ticketThreadId = await resolveVendorJobConversationId(supabase, {
      landlordId,
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      vendorPhone: phone,
    })
    const sentOnTicketThread =
      alertResult.ok &&
      ticketThreadId &&
      alertResult.conversationId === ticketThreadId

    if (!sentOnTicketThread) {
      await appendEstimateDecisionStatusToVendorThread(supabase, {
        landlordId,
        ticketId: params.ticketId,
        vendorId: params.vendorId,
        vendorPhone: phone,
        estimateId: params.estimateId,
        decision: params.approved ? "approved" : "rejected",
        body,
      })
    }
  }
}

export async function submitMaintenanceEstimate(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    money: EstimateMoneyInput
  },
): Promise<
  | { ok: true; estimateId: string; status: string }
  | { ok: false; error: string; status?: number }
> {
  const moneyNorm = normalizeEstimateMoney(params.money)
  if ("error" in moneyNorm) {
    return { ok: false, error: moneyNorm.error, status: 400 }
  }

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, assigned_vendor_id, vendor_work_status",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (tErr || !ticket) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (ticket.assigned_vendor_id !== params.vendorId) {
    return { ok: false, error: "This job is not assigned to your company", status: 403 }
  }

  const landlordId =
    (typeof ticket.landlord_id === "string" && ticket.landlord_id.trim()) ||
    resolveLandlordId()

  // Supersede any prior pending estimate for this ticket.
  await supabase
    .from("maintenance_estimates")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("maintenance_request_id", params.ticketId)
    .eq("status", "pending_approval")

  const actionToken = crypto.randomUUID()
  const notes =
    typeof params.money.notes === "string" && params.money.notes.trim()
      ? params.money.notes.trim().slice(0, 2000)
      : null

  const { data: inserted, error: insErr } = await supabase
    .from("maintenance_estimates")
    .insert({
      maintenance_request_id: params.ticketId,
      landlord_id: landlordId,
      vendor_id: params.vendorId,
      parts_cost: moneyNorm.partsCost,
      labor_cost: moneyNorm.laborCost,
      total_cost: moneyNorm.totalCost,
      notes,
      status: "pending_approval",
      landlord_action_token: actionToken,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (insErr || !inserted?.id) {
    console.error("[maintenance-estimates] insert", insErr?.message)
    return {
      ok: false,
      error: insErr?.message || "Could not save estimate",
      status: 500,
    }
  }

  const estimateId = inserted.id as string

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, phone")
    .eq("id", params.vendorId)
    .maybeSingle()
  const vendorName =
    typeof vendor?.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "Vendor"
  const vendorPhone = typeof vendor?.phone === "string" ? vendor.phone : null

  try {
    await appendMaintenanceEstimateSubmittedToInbox(supabase, {
      landlordId,
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      vendorPhone,
      estimateId,
      partsCost: moneyNorm.partsCost,
      laborCost: moneyNorm.laborCost,
      totalCost: moneyNorm.totalCost,
      notes,
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
    })
  } catch (e) {
    console.error("[maintenance-estimates] inbox mirror", e)
  }

  try {
    await notifyLandlordEstimatePending(supabase, {
      landlordId,
      estimateId,
      actionToken,
      ticketId: params.ticketId,
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
      vendorName,
      partsCost: moneyNorm.partsCost,
      laborCost: moneyNorm.laborCost,
      totalCost: moneyNorm.totalCost,
      notes,
    })
  } catch (e) {
    console.error("[maintenance-estimates] landlord notify", e)
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "maintenance.estimate_submitted",
      source: "vendor_portal",
      actor_type: "vendor",
      actor_id: params.vendorId,
      vendor_id: params.vendorId,
      maintenance_request_id: params.ticketId,
      metadata: {
        estimate_id: estimateId,
        parts_cost: moneyNorm.partsCost,
        labor_cost: moneyNorm.laborCost,
        total_cost: moneyNorm.totalCost,
      },
    })
  } catch (e) {
    console.error("[maintenance-estimates] graph", e)
  }

  return { ok: true, estimateId, status: "pending_approval" }
}

export async function decideMaintenanceEstimate(
  supabase: SupabaseClient,
  params: {
    estimateId: string
    actionToken: string
    action: "approve" | "reject"
    /** Where the decision came from (maps to operations graph source). */
    source?: "sms" | "sms_inbound" | "admin" | "email_link"
  },
): Promise<
  | { ok: true; status: "approved" | "rejected"; already?: boolean }
  | { ok: false; error: string; status?: number }
> {
  const { data: row, error } = await supabase
    .from("maintenance_estimates")
    .select(
      "id, status, landlord_id, vendor_id, maintenance_request_id, landlord_action_token, total_cost, vendor_notified_at",
    )
    .eq("id", params.estimateId)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, error: "Estimate not found", status: 404 }
  }
  if (row.landlord_action_token !== params.actionToken) {
    return { ok: false, error: "Invalid or expired link", status: 403 }
  }

  if (row.status === "approved" || row.status === "rejected") {
    return {
      ok: true,
      status: row.status as "approved" | "rejected",
      already: true,
    }
  }
  if (row.status !== "pending_approval") {
    return { ok: false, error: "This estimate can no longer be updated", status: 409 }
  }

  const next = params.action === "approve" ? "approved" : "rejected"
  const nowIso = new Date().toISOString()
  const { error: upErr } = await supabase
    .from("maintenance_estimates")
    .update({
      status: next,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", params.estimateId)
    .eq("status", "pending_approval")

  if (upErr) {
    console.error("[maintenance-estimates] decide", upErr.message)
    return { ok: false, error: "Could not update estimate", status: 500 }
  }

  const ticketId = row.maintenance_request_id as string
  const vendorId = row.vendor_id as string
  const wo = formatWorkOrderRef(ticketId)

  try {
    await notifyVendorEstimateDecision(supabase, {
      ticketId,
      vendorId,
      estimateId: params.estimateId,
      approved: next === "approved",
      totalCost: Number(row.total_cost) || 0,
      workOrderRef: wo,
    })
    await supabase
      .from("maintenance_estimates")
      .update({ vendor_notified_at: new Date().toISOString() })
      .eq("id", params.estimateId)
  } catch (e) {
    console.error("[maintenance-estimates] vendor notify", e)
  }

  const graphSource =
    params.source === "admin"
      ? "dashboard"
      : params.source === "sms_inbound" || params.source === "email_link"
        ? "sms"
        : "sms"

  try {
    await logGraphEvent(supabase, {
      landlord_id: row.landlord_id as string,
      event_type:
        next === "approved"
          ? "maintenance.estimate_approved"
          : "maintenance.estimate_rejected",
      source: graphSource,
      actor_type: "landlord",
      vendor_id: vendorId,
      maintenance_request_id: ticketId,
      metadata: {
        estimate_id: params.estimateId,
        total_cost: Number(row.total_cost) || 0,
        decision_channel: params.source ?? "sms",
      },
    })
  } catch (e) {
    console.error("[maintenance-estimates] graph decide", e)
  }

  return { ok: true, status: next }
}

export async function loadEstimateContextForJobToken(
  supabase: SupabaseClient,
  jobToken: string,
): Promise<
  | {
      ok: true
      ticketId: string
      vendorId: string
      workOrderRef: string
      unit: string
      description: string
      pendingEstimate: {
        id: string
        partsCost: number
        laborCost: number
        totalCost: number
        notes: string | null
        status: string
      } | null
    }
  | { ok: false; error: string; status: number }
> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, unit, description, assigned_vendor_id, vendor_action_token",
    )
    .eq("vendor_action_token", jobToken)
    .maybeSingle()

  if (error || !ticket?.id) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (typeof ticket.assigned_vendor_id !== "string" || !ticket.assigned_vendor_id) {
    return { ok: false, error: "No vendor assigned to this job", status: 400 }
  }

  const { data: pending } = await supabase
    .from("maintenance_estimates")
    .select("id, parts_cost, labor_cost, total_cost, notes, status")
    .eq("maintenance_request_id", ticket.id)
    .eq("status", "pending_approval")
    .maybeSingle()

  return {
    ok: true,
    ticketId: ticket.id as string,
    vendorId: ticket.assigned_vendor_id,
    workOrderRef: formatWorkOrderRef(ticket.id as string),
    unit: typeof ticket.unit === "string" ? ticket.unit : "",
    description: typeof ticket.description === "string" ? ticket.description : "",
    pendingEstimate: pending
      ? {
          id: pending.id as string,
          partsCost: Number(pending.parts_cost) || 0,
          laborCost: Number(pending.labor_cost) || 0,
          totalCost: Number(pending.total_cost) || 0,
          notes: typeof pending.notes === "string" ? pending.notes : null,
          status: String(pending.status),
        }
      : null,
  }
}
