import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  loadJobStateForTicket,
  loadMostRecentlyAssignedVendorId,
  resolveVendorAssignmentDecision,
  touchVendorLastAssignedAt,
  isVendorMatchableForDispatch,
} from "../_shared/vendor_assignment.ts"
import { vendorTradeMatchesForDispatch } from "../_shared/vendor_trades.ts"
import {
  vendorCoversJobState,
  vendorServiceStateCodes,
} from "../_shared/vendorServiceArea.ts"
import { sendResendEmail } from "../_shared/delivery.ts"
import { sendVendorJobAlert } from "../_shared/sms/vendorSmsRouting.ts"
import { signVendorEmailAction } from "../_shared/vendor_action_token.ts"
import {
  buildVendorJobAssignmentEmailText,
  buildVendorJobAssignmentSms,
  buildVendorJobAssignmentSubject,
} from "../_shared/vendor_outreach_copy.ts"
import { notifyResidentVendorAssigned } from "./resident_notify.ts"
import { getEstimatedMinutes } from "../_shared/sla_rules.ts"
import {
  loadLandlordMarketplacePreference,
  loadLandlordOperationalSettings,
  resolveTicketSlaMinutes,
} from "../_shared/landlordNotificationPrefs.ts"
import { uloAppOrigin, uloAppUrl } from "../_shared/uloAppUrl.ts"
import { emitServerProductEvent } from "../_shared/ga4MeasurementProtocol.ts"
import {
  AWAITING_LANDLORD_VENDOR_CHOICE,
  notifyLandlordVendorChoice,
} from "../_shared/vendorLandlordChoice.ts"
import {
  startVendorAvailabilityProbe,
  ticketIsAwaitingVendorAvailabilityProbe,
  ticketIsUrgentForVendorProbe,
} from "../_shared/vendorAvailabilityProbe.ts"
import { resumeMaintenanceWorkflowAfterVendorAssigned } from "../_shared/maintenance_admin_escalation.ts"

export type TicketNotifyPayload = {
  ticketId: string
  /** Same values as resident urgency (`urgency` / `priority` on maintenance_requests). */
  priority: string
  unit: string
  description: string
  /** Clean issue line for vendor SMS. Prefer this over description. */
  issueHeadline?: string | null
  /** Structured entry permission; null/undefined when unknown. */
  entryOkIfAbsent?: boolean | null
  severity?: string | null
  urgency?: string | null
  /** ISO timestamp from SLA `due_at` (optional for legacy tickets). */
  dueAt?: string | null
  /** Deterministic SLA window in minutes (not from AI). */
  estimatedMinutes?: number | null
  /** Scope vendor pick to this landlord when known. */
  landlordId?: string | null
  /**
   * When set (e.g. second same-trade ticket for the same unit), assign this
   * vendor if still ACTIVE for dispatch instead of picking a new one.
   * Still requires landlord SMS acknowledgement unless `landlordAcknowledged`.
   */
  preferVendorId?: string | null
  /** Landlord already confirmed this assignment by SMS (reply YES / 1 / 2). */
  landlordAcknowledged?: boolean
  /**
   * Re-text the landlord with the current matchable vendors even if we already
   * asked once. Does not assign.
   */
  refreshLandlordChoice?: boolean
  /** Resident-offered visit windows from intake (shown on assignment SMS). */
  residentAvailabilityText?: string | null
  /**
   * Retry assignment when the ticket was already marked notified but still has
   * no vendor (e.g. landlord Override after a no-vendor submit).
   */
  retryIfUnassigned?: boolean
  /**
   * Resident confirmed the request (SMS YES / web submit). Ignore leftover
   * draft dispatch flags and still offer preferred or nearby vendors.
   */
  residentConfirmed?: boolean
}

type VendorRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  notification_channel: string
  active: boolean
  category: string | null
  portal_api_key: string | null
}

type VendorEmailLinks = {
  portalHome: string
  viewJob: string
  acceptUrl: string | null
  declineUrl: string | null
}

function resolveAppBaseUrl(): string | null {
  const origin = uloAppOrigin({ fallback: "" })
  return origin || null
}

function resolveVendorRespondBaseUrl(): string | null {
  const explicit = Deno.env.get("VENDOR_RESPOND_FN_URL")?.trim()?.replace(/\/$/, "") ?? ""
  if (explicit) return explicit
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()?.replace(/\/$/, "") ?? ""
  if (!supabaseUrl) return null
  return `${supabaseUrl}/functions/v1/vendor-respond`
}

async function buildVendorEmailLinks(
  ticketId: string,
  _vendorId: string,
  actionToken: string | null,
): Promise<VendorEmailLinks | null> {
  const appBase = resolveAppBaseUrl()
  if (!appBase) return null
  const portalHome = actionToken?.trim()
    ? uloAppUrl.workOrder(actionToken.trim())
    : `${appBase}/vendor`
  const viewJob = actionToken?.trim()
    ? uloAppUrl.workOrder(actionToken.trim())
    : `${appBase}/vendor/ticket/${ticketId}`
  const signingSecret = Deno.env.get("VENDOR_EMAIL_ACTION_SECRET")?.trim() ?? null
  const respondBase = resolveVendorRespondBaseUrl()
  let acceptUrl: string | null = null
  let declineUrl: string | null = null
  if (signingSecret && respondBase) {
    try {
      const acceptTok = await signVendorEmailAction(signingSecret, {
        ticketId,
        vendorId: _vendorId,
        action: "accept",
      })
      const declineTok = await signVendorEmailAction(signingSecret, {
        ticketId,
        vendorId: _vendorId,
        action: "decline",
      })
      acceptUrl =
        `${respondBase}?action=accept&ticketId=${encodeURIComponent(ticketId)}&vendorId=${encodeURIComponent(_vendorId)}&token=${encodeURIComponent(acceptTok)}`
      declineUrl =
        `${respondBase}?action=decline&ticketId=${encodeURIComponent(ticketId)}&vendorId=${encodeURIComponent(_vendorId)}&token=${encodeURIComponent(declineTok)}`
    } catch (e) {
      console.error("[vendor-notify] sign email action", e)
    }
  }
  return { portalHome, viewJob, acceptUrl, declineUrl }
}

function buildEmailBodies(
  payload: TicketNotifyPayload,
  vendorName: string,
  links: VendorEmailLinks | null,
  fallbackManageUrl: string | null,
  accessCode: string | null,
): {
  text: string
  html: string
} {
  const text = buildVendorJobAssignmentEmailText({
    vendorName,
    priority: payload.priority,
    unit: payload.unit,
    description: payload.description,
    ticketId: payload.ticketId,
    dueAt: payload.dueAt,
    estimatedMinutes: payload.estimatedMinutes,
    viewJobUrl: links?.viewJob ?? fallbackManageUrl,
    acceptUrl: links?.acceptUrl ?? null,
    declineUrl: links?.declineUrl ?? null,
    portalHomeUrl: links?.portalHome ?? null,
    accessCode,
  })

  const first = vendorName.trim().split(/\s+/)[0] || "there"
  const unit = payload.unit.trim() || "the property"
  const dueRow =
    payload.dueAt && payload.dueAt.trim()
      ? `<tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Respond by</td><td><strong>${escapeHtml(new Date(payload.dueAt).toLocaleString())}</strong></td></tr>`
      : ""
  const estRow =
    typeof payload.estimatedMinutes === "number" &&
    Number.isFinite(payload.estimatedMinutes)
      ? `<tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Target time</td><td><strong>${escapeHtml(String(payload.estimatedMinutes))} minutes</strong></td></tr>`
      : ""
  const accessCodeHtml = accessCode?.trim()
    ? `<p style="margin: 14px 0 0; font-size: 14px; color: #6a7282;">Your sign-in code</p>
  <p style="margin: 4px 0 12px;"><code style="display:inline-block;padding:8px 10px;border-radius:6px;background:#f3f4f6;border:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(accessCode.trim())}</code></p>
  <p style="margin: 0 0 12px;">Use this on the vendor portal if you're asked to log in.</p>`
    : ""

  const actionButtonsHtml =
    links && (links.acceptUrl || links.declineUrl)
      ? `<p style="margin: 20px 0 12px;">
    ${links.acceptUrl ? `<a href="${escapeHtml(links.acceptUrl)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#9810fa;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Accept job</a>` : ""}
    ${links.declineUrl ? `<a href="${escapeHtml(links.declineUrl)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#f3f4f6;color:#101828;text-decoration:none;border-radius:8px;font-weight:600;border:1px solid #e5e7eb;">Decline job</a>` : ""}
  </p>`
      : ""

  const portalLinksHtml = links
    ? `<p style="margin: 12px 0;">
    <a href="${escapeHtml(links.portalHome)}" style="color:#9810fa;font-weight:600;">Vendor portal</a>
    · <a href="${escapeHtml(links.viewJob)}" style="color:#9810fa;font-weight:600;">View job</a>
  </p>`
    : fallbackManageUrl
      ? `<p><a href="${escapeHtml(fallbackManageUrl)}">Open vendor portal</a></p>`
      : ""

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #101828;">
  <p>Hi ${escapeHtml(first)},</p>
  <p>You have a <strong>new maintenance job</strong> at ${escapeHtml(unit)}.</p>
  <table style="border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Priority</td><td><strong>${escapeHtml(payload.priority)}</strong></td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Location</td><td><strong>${escapeHtml(unit)}</strong></td></tr>
    ${dueRow}
    ${estRow}
  </table>
  <p style="color: #6a7282; font-size: 14px;">What's needed</p>
  <p style="white-space: pre-wrap;">${escapeHtml(payload.description)}</p>
  <p style="font-size: 12px; color: #6a7282;">Job ref: ${escapeHtml(payload.ticketId)}</p>
  ${portalLinksHtml}
  ${accessCodeHtml}
  ${actionButtonsHtml}
  <p>Thanks!</p>
</body>
</html>`.trim()

  return { text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildJobDetailUrl(actionToken: string | null | undefined): string | null {
  const token = actionToken?.trim()
  if (!token || !resolveAppBaseUrl()) return null
  return uloAppUrl.workOrder(token)
}

function buildSmsBody(
  payload: TicketNotifyPayload,
  vendorName: string,
  actionToken: string | null,
  legacyViewUrl: string | null,
): string {
  return buildVendorJobAssignmentSms({
    vendorName,
    priority: payload.priority,
    unit: payload.unit,
    description: payload.description,
    ticketId: payload.ticketId,
    jobDetailUrl: buildJobDetailUrl(actionToken) ?? legacyViewUrl,
    residentAvailabilityText: payload.residentAvailabilityText,
  })
}

/**
 * Picks an Active vendor in the same trade, or an Active general / handyman
 * if no specialist is available. Does not assign a different specialist trade.
 */
function isEmergencyPriority(priority: string | null | undefined): boolean {
  const p = (priority ?? "").trim().toLowerCase()
  return p === "emergency" || p === "critical" || p === "urgent"
}

async function loadPreferredVendorIfMatchable(
  supabase: SupabaseClient,
  vendorId: string,
  landlordId?: string | null,
  issueCategory?: string | null,
  jobState?: string | null,
): Promise<VendorRow | null> {
  const id = vendorId.trim()
  if (!id) return null

  let query = supabase
    .from("vendors")
    .select(
      "id,name,email,phone,notification_channel,active,category,portal_api_key,roster_status,onboarding_overridden_at",
    )
    .eq("id", id)
    .eq("active", true)
  const lid = landlordId?.trim() || null
  if (lid) query = query.eq("landlord_id", lid)

  const { data: vendor, error } = await query.maybeSingle()
  if (error || !vendor) {
    if (error) {
      console.error("[vendor-notify] prefer vendor lookup", error.message)
    }
    return null
  }

  let verifQuery = supabase
    .from("vendor_verifications")
    .select("status, availability, service_area, license_state, updated_at")
    .eq("vendor_id", vendor.id)
    .order("updated_at", { ascending: false })
    .limit(1)
  if (lid) verifQuery = verifQuery.eq("landlord_id", lid)
  const { data: verif } = await verifQuery.maybeSingle()

  if (
    !isVendorMatchableForDispatch({
      verificationStatus: typeof verif?.status === "string" ? verif.status : null,
      vendorActive: vendor.active,
      availability: typeof verif?.availability === "string"
        ? verif.availability
        : null,
      rosterStatus: typeof vendor.roster_status === "string"
        ? vendor.roster_status
        : null,
      onboardingOverriddenAt: typeof vendor.onboarding_overridden_at === "string"
        ? vendor.onboarding_overridden_at
        : null,
    })
  ) {
    return null
  }

  const vendorCategory =
    typeof vendor.category === "string" ? vendor.category : null
  if (!vendorTradeMatchesForDispatch(vendorCategory, issueCategory ?? null)) {
    return null
  }

  const vendorStates = vendorServiceStateCodes({
    serviceArea: verif?.service_area ?? null,
    licenseState: typeof verif?.license_state === "string" ? verif.license_state : null,
  })
  if (!vendorCoversJobState(vendorStates, jobState)) {
    return null
  }

  return {
    id: vendor.id,
    name: vendor.name,
    email: vendor.email,
    phone: vendor.phone,
    notification_channel: vendor.notification_channel,
    active: vendor.active,
    category: vendor.category,
    portal_api_key: vendor.portal_api_key,
  }
}

async function insertLog(
  supabase: SupabaseClient,
  ticketId: string,
  _vendorId: string,
  channel: "email" | "sms",
  providerMessageId: string | null,
  error: string | null,
): Promise<void> {
  const { error: insErr } = await supabase.from("vendor_notification_log").insert({
    ticket_id: ticketId,
    vendor_id: _vendorId,
    channel,
    provider_message_id: providerMessageId,
    error,
  })
  if (insErr) console.error("[vendor-notify] log insert", insErr)
}

/** Fallback deep link when `buildVendorEmailLinks` cannot resolve APP_URL. */
function portalManageUrl(ticketId: string): string | null {
  const appBase = resolveAppBaseUrl()
  if (!appBase) return null
  return `${appBase}/vendor/ticket/${encodeURIComponent(ticketId)}`
}

/**
 * Sends email/SMS for an assignment; returns non-fatal channel errors.
 */
async function notifyChannelsForAssignment(
  supabase: SupabaseClient,
  ticketId: string,
  vendor: VendorRow,
  payload: TicketNotifyPayload,
  actionToken: string | null,
): Promise<string[]> {
  const errors: string[] = []
  const ch = vendor.notification_channel

  const wantEmail = ch === "email" || ch === "both"
  const wantSms = ch === "sms" || ch === "both"

  const emailLinks = await buildVendorEmailLinks(ticketId, vendor.id, actionToken)
  const legacyManage = portalManageUrl(ticketId)
  const jobDetailUrl = buildJobDetailUrl(actionToken) ?? emailLinks?.viewJob ?? legacyManage

  if (wantEmail) {
    if (!vendor.email?.trim()) {
      errors.push("email: vendor has no email")
      await insertLog(supabase, ticketId, vendor.id, "email", null, "no vendor email")
    } else {
      const { text, html } = buildEmailBodies(
        payload,
        vendor.name,
        emailLinks,
        legacyManage,
        null,
      )
      const subject = buildVendorJobAssignmentSubject(payload.unit)
      const r = await sendResendEmail(vendor.email.trim(), subject, text, html)
      if ("error" in r) {
        errors.push(`email: ${r.error}`)
        await insertLog(supabase, ticketId, vendor.id, "email", null, r.error)
      } else {
        await insertLog(supabase, ticketId, vendor.id, "email", r.id, null)
      }
    }
  }

  if (wantSms) {
    if (!vendor.phone?.trim()) {
      errors.push("sms: vendor has no phone")
      await insertLog(supabase, ticketId, vendor.id, "sms", null, "no vendor phone")
    } else {
      const smsBody = buildSmsBody(
        payload,
        vendor.name,
        actionToken,
        jobDetailUrl,
      )
      // Always scope the sender line to the ticket landlord — never fall back to
      // DEFAULT_LANDLORD_ID or SMS will miss New Landlord's Twilio number.
      let landlordId = payload.landlordId?.trim() || null
      if (!landlordId) {
        const { data: ticketLandlord } = await supabase
          .from("maintenance_requests")
          .select("landlord_id")
          .eq("id", ticketId)
          .maybeSingle()
        landlordId =
          typeof ticketLandlord?.landlord_id === "string"
            ? ticketLandlord.landlord_id.trim()
            : null
      }
      const r = await sendVendorJobAlert(supabase, {
        ticketId,
        vendorId: vendor.id,
        vendorPhone: vendor.phone.trim(),
        body: smsBody,
        landlordId,
      })
      if (!r.ok) {
        errors.push(`sms: ${r.error}`)
        await insertLog(supabase, ticketId, vendor.id, "sms", null, r.error)
      } else {
        await insertLog(
          supabase,
          ticketId,
          vendor.id,
          "sms",
          r.providerMessageSid,
          null,
        )
        // Job detail link is SMS 3 after YES → scheduling ask (see beginVendorAvailabilityAsk).
      }
    }
  }

  return errors
}

export type VendorAssignSkipReason =
  | "no_vendor"
  | "ai_dispatch_disabled"
  | "assign_failed"
  | "ticket_missing"
  | "awaiting_landlord_choice"
  | "awaiting_vendor_probe"

export type AssignVendorResult = {
  assigned: boolean
  vendorId: string | null
  skipReason?: VendorAssignSkipReason
}

/**
 * Assigns an active vendor to the ticket and sends email/SMS per vendor.notification_channel.
 * Does not throw — logs errors and sets maintenance_requests.vendor_notify_error.
 * Returns whether a vendor was persisted on the ticket.
 */
export async function assignVendorAndNotify(
  supabase: SupabaseClient,
  payload: TicketNotifyPayload,
): Promise<AssignVendorResult> {
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select(
      "id, vendor_notified_at, vendor_notify_error, issue_category, resident_availability_text, assigned_vendor_id, issue_headline, entry_ok_if_absent, priority, urgency, severity",
    )
    .eq("id", payload.ticketId)
    .maybeSingle()

  if (!ticket) {
    console.error("[vendor-notify] ticket not found", payload.ticketId)
    return { assigned: false, vendorId: null, skipReason: "ticket_missing" }
  }
  if (payload.residentConfirmed === true) {
    payload.retryIfUnassigned = true
    payload.refreshLandlordChoice = true
  }
  const existingVendorId =
    typeof ticket.assigned_vendor_id === "string" && ticket.assigned_vendor_id.trim()
      ? ticket.assigned_vendor_id.trim()
      : null
  const preferVendorId = payload.preferVendorId?.trim() || ""
  const alreadyNotified =
    typeof ticket.vendor_notified_at === "string" &&
    Boolean(ticket.vendor_notified_at.trim())
  // Probe soft-offer may set assigned_vendor_id without a job SMS. Landlord YES
  // with the same preferVendorId must continue into notify, not short-circuit.
  const landlordNeedsNotify =
    payload.landlordAcknowledged === true &&
    Boolean(preferVendorId) &&
    preferVendorId === existingVendorId &&
    !alreadyNotified
  if (existingVendorId && !landlordNeedsNotify) {
    // #region agent log
    fetch("http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "5d0562",
      },
      body: JSON.stringify({
        sessionId: "5d0562",
        runId: "pre-fix",
        hypothesisId: "D",
        location: "vendor_notify.ts:existingVendorEarlyReturn",
        message: "assignVendorAndNotify early return existing assignment",
        data: {
          ticketId: payload.ticketId,
          existingVendorId,
          preferVendorId: preferVendorId || null,
          alreadyNotified,
          landlordAcknowledged: payload.landlordAcknowledged === true,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    try {
      await resumeMaintenanceWorkflowAfterVendorAssigned(supabase, {
        ticketId: payload.ticketId,
        vendorId: existingVendorId,
        currentStep: "awaiting_vendor_accept",
      })
    } catch (e) {
      console.error("[vendor-notify] resume workflow after existing assignment", e)
    }
    return { assigned: true, vendorId: existingVendorId }
  }
  if (landlordNeedsNotify) {
    // #region agent log
    fetch("http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "5d0562",
      },
      body: JSON.stringify({
        sessionId: "5d0562",
        runId: "pre-fix",
        hypothesisId: "D",
        location: "vendor_notify.ts:landlordNeedsNotify",
        message: "continuing assign+notify despite existing assignment",
        data: {
          ticketId: payload.ticketId,
          existingVendorId,
          preferVendorId,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
  }
  if (ticket.vendor_notified_at && !payload.retryIfUnassigned) {
    console.log("[vendor-notify] skip, already notified", payload.ticketId)
    return {
      assigned: false,
      vendorId: null,
      skipReason: "no_vendor",
    }
  }

  if (!payload.residentAvailabilityText?.trim()) {
    const fromTicket = typeof ticket.resident_availability_text === "string"
      ? ticket.resident_availability_text.trim()
      : ""
    if (fromTicket) payload.residentAvailabilityText = fromTicket
  }
  if (!payload.issueHeadline?.trim()) {
    const headline = typeof ticket.issue_headline === "string"
      ? ticket.issue_headline.trim()
      : ""
    if (headline) payload.issueHeadline = headline
  }
  if (payload.entryOkIfAbsent == null && typeof ticket.entry_ok_if_absent === "boolean") {
    payload.entryOkIfAbsent = ticket.entry_ok_if_absent
  }
  if (!payload.urgency?.trim() && typeof ticket.urgency === "string") {
    payload.urgency = ticket.urgency
  }
  if (!payload.severity?.trim() && typeof ticket.severity === "string") {
    payload.severity = ticket.severity
  }
  if (!payload.priority?.trim() && typeof ticket.priority === "string") {
    payload.priority = ticket.priority
  }

  const issueCategory =
    typeof ticket.issue_category === "string" && ticket.issue_category.trim()
      ? ticket.issue_category.trim()
      : null

  let landlordId = payload.landlordId?.trim() || null
  if (!landlordId) {
    const { data: ticketLandlord } = await supabase
      .from("maintenance_requests")
      .select("landlord_id")
      .eq("id", payload.ticketId)
      .maybeSingle()
    landlordId =
      typeof ticketLandlord?.landlord_id === "string"
        ? ticketLandlord.landlord_id.trim()
        : null
  }
  payload.landlordId = landlordId

  const jobState = await loadJobStateForTicket(supabase, {
    ticketId: payload.ticketId,
    landlordId,
  })

  const alreadyAwaitingChoice =
    typeof ticket.vendor_notify_error === "string" &&
    ticket.vendor_notify_error.includes(AWAITING_LANDLORD_VENDOR_CHOICE)
  const alreadyAwaitingProbe =
    typeof ticket.vendor_notify_error === "string" &&
    ticketIsAwaitingVendorAvailabilityProbe(ticket.vendor_notify_error)
  // Probe must not restart when residentConfirmed sets refreshLandlordChoice.
  if (alreadyAwaitingProbe && payload.landlordAcknowledged !== true) {
    return {
      assigned: false,
      vendorId: null,
      skipReason: "awaiting_vendor_probe",
    }
  }
  if (
    alreadyAwaitingChoice &&
    payload.landlordAcknowledged !== true &&
    payload.refreshLandlordChoice !== true
  ) {
    return {
      assigned: false,
      vendorId: null,
      skipReason: "awaiting_landlord_choice",
    }
  }

  const operational = landlordId
    ? await (async () => {
      const { loadLandlordOperationalSettings } = await import(
        "../_shared/landlordNotificationPrefs.ts"
      )
      return loadLandlordOperationalSettings(supabase, landlordId)
    })()
    : null
  if (operational && operational.allowAiDispatch === false && payload.residentConfirmed !== true) {
    console.log("[vendor-notify] AI dispatch disabled; awaiting landlord approval", {
      ticketId: payload.ticketId,
      landlordId,
    })
    await supabase
      .from("maintenance_requests")
      .update({
        vendor_notify_error: "Awaiting landlord approval before vendor dispatch",
      })
      .eq("id", payload.ticketId)
    return { assigned: false, vendorId: null, skipReason: "ai_dispatch_disabled" }
  }

  let vendor = null as Awaited<ReturnType<typeof loadPreferredVendorIfMatchable>>
  if (payload.landlordAcknowledged === true && payload.preferVendorId?.trim()) {
    vendor = await loadPreferredVendorIfMatchable(
      supabase,
      payload.preferVendorId,
      landlordId,
      issueCategory,
      jobState,
    )
  } else if (landlordId) {
    const preferNot = await loadMostRecentlyAssignedVendorId(supabase)
    const marketplacePreference = await loadLandlordMarketplacePreference(
      supabase,
      landlordId,
    )
    const decision = await resolveVendorAssignmentDecision(supabase, {
      issueCategory,
      excludeVendorIds: [],
      preferNotVendorId: preferNot,
      landlordId,
      preferPreferredEmergency: isEmergencyPriority(payload.priority),
      marketplacePreference,
      jobState,
    })
    if (decision.kind === "landlord_choice") {
      // Refresh after landlord was already asked: re-text choice, do not re-probe.
      if (alreadyAwaitingChoice) {
        await notifyLandlordVendorChoice(supabase, {
          landlordId,
          ticketId: payload.ticketId,
          unit: payload.unit,
          issueCategory,
          options: decision.options,
        })
        await supabase
          .from("maintenance_requests")
          .update({ vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE })
          .eq("id", payload.ticketId)
        return {
          assigned: false,
          vendorId: null,
          skipReason: "awaiting_landlord_choice",
        }
      }
      // Soft-offer availability first; landlord picks after vendors return slots.
      const probe = await startVendorAvailabilityProbe(supabase, {
        landlordId,
        ticketId: payload.ticketId,
        unit: payload.unit,
        issueCategory,
        description: payload.description,
        issueHeadline: payload.issueHeadline,
        entryOkIfAbsent: payload.entryOkIfAbsent,
        urgent: ticketIsUrgentForVendorProbe({
          priority: payload.priority,
          urgency: payload.urgency ?? payload.priority,
          severity: payload.severity,
        }),
        residentAvailabilityText: payload.residentAvailabilityText,
        options: decision.options,
      })
      if (probe.probed === 0) {
        // No reachable phones — fall back to immediate landlord choice.
        await notifyLandlordVendorChoice(supabase, {
          landlordId,
          ticketId: payload.ticketId,
          unit: payload.unit,
          issueCategory,
          options: decision.options,
        })
        await supabase
          .from("maintenance_requests")
          .update({ vendor_notify_error: AWAITING_LANDLORD_VENDOR_CHOICE })
          .eq("id", payload.ticketId)
        return {
          assigned: false,
          vendorId: null,
          skipReason: "awaiting_landlord_choice",
        }
      }
      return {
        assigned: false,
        vendorId: null,
        skipReason: "awaiting_vendor_probe",
      }
    }
    vendor = null
  } else {
    console.warn("[vendor-notify] no landlord to confirm vendor assignment", {
      ticketId: payload.ticketId,
    })
  }
  if (!vendor) {
    console.warn("[vendor-notify] no active vendor; skipping assignment and notify", {
      ticketId: payload.ticketId,
      issueCategory,
      landlordId,
    })
    await supabase
      .from("maintenance_requests")
      .update({
        vendor_notify_error: landlordId
          ? "No active vendor available in this service area"
          : "No active vendor available",
      })
      .eq("id", payload.ticketId)
    return { assigned: false, vendorId: null, skipReason: "no_vendor" }
  }
  const assignedAt = new Date().toISOString()
  const actionToken = crypto.randomUUID()
  /** Single update: assigned_vendor_id + pending_accept together satisfies require_vendor_for_progress.
   * Always clear landlord/probe awaiting notify flags so the ticket cannot stay stuck on
   * "Awaiting landlord vendor choice" after assignment (see stale-awaiting-flag-autofix). */
  const { error: assignError } = await supabase
    .from("maintenance_requests")
    .update({
      assigned_vendor_id: vendor.id,
      assigned_at: assignedAt,
      vendor_action_token: actionToken,
      vendor_work_status: "pending_accept",
      issue_category: issueCategory ?? vendor.category ?? null,
      vendor_notify_error: null,
    })
    .eq("id", payload.ticketId)

  if (assignError) {
    console.error(
      "[vendor-notify] failed to persist vendor assignment + workflow",
      assignError,
    )
    await supabase
      .from("maintenance_requests")
      .update({ vendor_notify_error: assignError.message })
      .eq("id", payload.ticketId)
    return { assigned: false, vendorId: null, skipReason: "assign_failed" }
  }

  console.log("[vendor-notify] assigned vendor persisted", {
    ticketId: payload.ticketId,
    _vendorId: vendor.id,
  })
  void emitServerProductEvent(supabase, {
    eventName: "vendor_matched",
    landlordId,
    properties: { job_type: issueCategory ?? undefined },
  })

  await touchVendorLastAssignedAt(supabase, vendor.id, landlordId)

  try {
    await resumeMaintenanceWorkflowAfterVendorAssigned(supabase, {
      ticketId: payload.ticketId,
      vendorId: vendor.id,
      currentStep: "awaiting_vendor_accept",
    })
  } catch (e) {
    console.error("[vendor-notify] resume workflow after assignment", e)
  }

  const errors = await notifyChannelsForAssignment(
    supabase,
    payload.ticketId,
    vendor,
    payload,
    actionToken,
  )

  const now = new Date().toISOString()
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notified_at: now,
      vendor_notify_error: errors.length > 0 ? errors.join("; ") : null,
    })
    .eq("id", payload.ticketId)

  if (errors.length > 0) {
    console.warn("[vendor-notify] completed with errors", payload.ticketId, errors)
  }

  // Resident is notified when a vendor is lined up; landlord confirmed-assignment
  // wait until schedule is confirmed (see confirmVendorSchedule).
  const { data: contact } = await supabase
    .from("maintenance_requests")
    .select(
      "resident_name, email, resident_phone, unit, resident_notification_channel",
    )
    .eq("id", payload.ticketId)
    .maybeSingle()

  if (contact) {
    await notifyResidentVendorAssigned(supabase, {
      ticketId: payload.ticketId,
      recipientName: String(contact.resident_name ?? ""),
      recipientEmail:
        typeof contact.email === "string" ? contact.email.trim() : "",
      recipientPhone:
        typeof contact.resident_phone === "string"
          ? contact.resident_phone
          : null,
      notificationChannel:
        typeof contact.resident_notification_channel === "string"
          ? contact.resident_notification_channel
          : null,
      unit: typeof contact.unit === "string" ? contact.unit : undefined,
      priority: payload.priority,
      vendorName: vendor.name,
    })
  }

  return { assigned: true, vendorId: vendor.id }
}

/**
 * Admin reassignment: sets `assigned_vendor_id`, rotates `vendor_action_token`, resets workflow to
 * `pending_accept`, clears prior notify timestamps, recomputes `due_at` / `estimated_minutes` from
 * now (existing minutes or SLA rules), notifies the new vendor, writes `vendor_status_events`.
 * Does not throw — returns `{ ok: true }` or `{ error: string }` for HTTP mapping.
 */
export type ReassignVendorNotifyOptions = {
  /** Audit `vendor_status_events.source` (default `edge`). */
  eventSource?: "edge" | "auto_reassign"
  /** When false, skip resident vendor-assigned notification (default true). */
  notifyResident?: boolean
}

export async function reassignVendorByIdAndNotify(
  supabase: SupabaseClient,
  ticketId: string,
  _vendorId: string,
  opts?: ReassignVendorNotifyOptions,
): Promise<{ ok: true } | { error: string }> {
  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, priority, urgency, unit, description, issue_headline, entry_ok_if_absent, vendor_work_status, issue_category, due_at, estimated_minutes, severity, assigned_vendor_id",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (tErr) {
    console.error("[vendor-notify] reassign load ticket", tErr)
    return { error: "Load ticket failed" }
  }
  if (!ticket) {
    return { error: "Ticket not found" }
  }

  const { data: vendor, error: vErr } = await supabase
    .from("vendors")
    .select(
      "id,name,email,phone,notification_channel,active,category,portal_api_key,roster_status,onboarding_overridden_at",
    )
    .eq("id", _vendorId)
    .eq("active", true)
    .maybeSingle()

  if (vErr) {
    console.error("[vendor-notify] reassign vendor lookup", vErr)
    return { error: "Load vendor failed" }
  }
  if (!vendor) {
    return { error: "Vendor not found or inactive" }
  }

  // Hard gate: only ACTIVE (verified + accepting + not platform-held) vendors.
  const reassignLandlordIdEarly =
    typeof ticket.landlord_id === "string" ? ticket.landlord_id.trim() : null
  let verifStatus: string | null = null
  let verifAvailability: string | null = null
  {
    let verifQuery = supabase
      .from("vendor_verifications")
      .select("status, availability, updated_at")
      .eq("vendor_id", vendor.id)
      .order("updated_at", { ascending: false })
      .limit(1)
    if (reassignLandlordIdEarly) {
      verifQuery = verifQuery.eq("landlord_id", reassignLandlordIdEarly)
    }
    const { data: verif } = await verifQuery.maybeSingle()
    verifStatus = typeof verif?.status === "string" ? verif.status : null
    verifAvailability = typeof verif?.availability === "string"
      ? verif.availability
      : null
  }
  if (
    !isVendorMatchableForDispatch({
      verificationStatus: verifStatus,
      vendorActive: vendor.active,
      availability: verifAvailability,
      rosterStatus: typeof vendor.roster_status === "string"
        ? vendor.roster_status
        : null,
      onboardingOverriddenAt: typeof vendor.onboarding_overridden_at === "string"
        ? vendor.onboarding_overridden_at
        : null,
    })
  ) {
    return { error: "Vendor is not ACTIVE for matching" }
  }
  const prevStatus = ticket.vendor_work_status as string
  const actionToken = crypto.randomUUID()

  const eventSource = opts?.eventSource ?? "edge"
  const notifyResident = opts?.notifyResident ?? true

  const existingIssueCat =
    typeof ticket.issue_category === "string" && ticket.issue_category.trim()
      ? ticket.issue_category.trim()
      : null

  const urgencyOrPriority =
    (typeof ticket.urgency === "string" && ticket.urgency.trim()
      ? ticket.urgency
      : ticket.priority) as string

  const severityRaw = ticket.severity as string | null | undefined
  const sevForSla =
    typeof severityRaw === "string" && severityRaw.trim()
      ? severityRaw.trim()
      : urgencyOrPriority
  const operational = reassignLandlordIdEarly
    ? await loadLandlordOperationalSettings(supabase, reassignLandlordIdEarly)
    : null
  const estRaw = ticket.estimated_minutes as number | null | undefined
  const estMin =
    typeof estRaw === "number" && Number.isFinite(estRaw) && estRaw > 0
      ? estRaw
      : resolveTicketSlaMinutes({
        category: existingIssueCat,
        severity: sevForSla,
        defaultResponseSla: operational?.defaultResponseSla ?? null,
        fallbackMinutes: (category, severity) =>
          getEstimatedMinutes(category, severity, null, {
            description: typeof ticket.description === "string" ? ticket.description : null,
          }),
      })
  const newDueAtIso = new Date(Date.now() + estMin * 60_000).toISOString()

  const previousVendorId =
    typeof ticket.assigned_vendor_id === "string" && ticket.assigned_vendor_id.trim()
      ? ticket.assigned_vendor_id.trim()
      : ""

  // Notify previous vendor they are off the job before binding the replacement.
  if (
    previousVendorId &&
    previousVendorId !== vendor.id &&
    reassignLandlordIdEarly
  ) {
    try {
      const { terminateWorkOrder } = await import(
        "../_shared/terminateWorkOrder.ts"
      )
      await terminateWorkOrder(supabase, {
        landlordId: reassignLandlordIdEarly,
        ticketId,
        mode: "release",
        source: "reassignment",
        actorType: "system",
        vendorId: previousVendorId,
        reason: "Job reassigned to another vendor",
        notifyVendor: true,
        clearAssignment: false,
        closeWorkflowRuns: false,
      })
    } catch (e) {
      console.error("[vendor-notify] previous vendor release notify", e)
    }
  }

  const assignedAt = new Date().toISOString()
  const { error: upAssign } = await supabase
    .from("maintenance_requests")
    .update({
      assigned_vendor_id: vendor.id,
      assigned_at: assignedAt,
      vendor_action_token: actionToken,
      vendor_work_status: "pending_accept",
      vendor_notified_at: null,
      vendor_notify_error: null,
      issue_category: existingIssueCat ?? vendor.category ?? null,
      due_at: newDueAtIso,
      estimated_minutes: estMin,
    })
    .eq("id", ticketId)

  if (upAssign) {
    console.error("[vendor-notify] reassign update failed", upAssign)
    return { error: upAssign.message ?? "Update failed" }
  }

  if (previousVendorId !== vendor.id) {
    void emitServerProductEvent(supabase, {
      eventName: "vendor_matched",
      landlordId: reassignLandlordIdEarly,
      properties: { job_type: existingIssueCat ?? undefined },
    })
  }

  const reassignLandlordId =
    typeof ticket.landlord_id === "string" ? ticket.landlord_id.trim() : null
  await touchVendorLastAssignedAt(supabase, vendor.id, reassignLandlordId)

  try {
    await resumeMaintenanceWorkflowAfterVendorAssigned(supabase, {
      ticketId,
      vendorId: vendor.id,
      currentStep: "awaiting_vendor_accept",
      eventStep: "vendor_reassigned",
    })
  } catch (e) {
    console.error("[vendor-notify] resume workflow after reassign", e)
  }

  const payload: TicketNotifyPayload = {
    ticketId,
    priority: urgencyOrPriority,
    unit: ticket.unit as string,
    description: ticket.description as string,
    issueHeadline: typeof ticket.issue_headline === "string"
      ? ticket.issue_headline
      : null,
    entryOkIfAbsent: typeof ticket.entry_ok_if_absent === "boolean"
      ? ticket.entry_ok_if_absent
      : null,
    urgency: typeof ticket.urgency === "string" ? ticket.urgency : null,
    severity: typeof ticket.severity === "string" ? ticket.severity : null,
    dueAt: newDueAtIso,
    estimatedMinutes: estMin,
    landlordId: reassignLandlordId,
  }

  const errors = await notifyChannelsForAssignment(
    supabase,
    ticketId,
    vendor as VendorRow,
    payload,
    actionToken,
  )

  const now = new Date().toISOString()
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notified_at: now,
      vendor_notify_error: errors.length > 0 ? errors.join("; ") : null,
    })
    .eq("id", ticketId)

  const { error: logErr } = await supabase.from("vendor_status_events").insert({
    ticket_id: ticketId,
    from_status: prevStatus,
    to_status: "pending_accept",
    source: eventSource,
    vendor_id: vendor.id,
  })
  if (logErr) console.error("[vendor-notify] reassign audit", logErr)

  if (errors.length > 0) {
    console.warn("[vendor-notify] reassign completed with notify errors", ticketId, errors)
  }

  const { data: contact } = await supabase
    .from("maintenance_requests")
    .select(
      "resident_name, email, resident_phone, unit, resident_notification_channel",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (notifyResident && contact) {
    await notifyResidentVendorAssigned(supabase, {
      ticketId,
      recipientName: String(contact.resident_name ?? ""),
      recipientEmail:
        typeof contact.email === "string" ? contact.email.trim() : "",
      recipientPhone:
        typeof contact.resident_phone === "string"
          ? contact.resident_phone
          : null,
      notificationChannel:
        typeof contact.resident_notification_channel === "string"
          ? contact.resident_notification_channel
          : null,
      unit: typeof contact.unit === "string" ? contact.unit : undefined,
      priority: urgencyOrPriority,
      vendorName: vendor.name as string,
    })
  }

  return { ok: true }
}
