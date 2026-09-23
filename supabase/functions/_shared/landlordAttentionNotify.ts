/**
 * Alert landlords when something lands in Needs Your Attention.
 * Best-effort SMS and/or email — never blocks the originating workflow.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendLandlordOpsEmail } from "./landlordOpsNotify.ts"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import { getSMSProviderForSend } from "./sms/providerFactory.ts"
import { uloAppUrl } from "./uloAppUrl.ts"
import {
  loadLandlordNotificationSettings,
  loadLandlordOperationalSettings,
  resolveLandlordNotificationDelivery,
} from "./landlordNotificationPrefs.ts"
import { resolveLandlordOpsPhones } from "./sms/tenantActivationAdminAlert.ts"
import {
  persistLandlordChoiceSms,
  type AwaitingVendorChoice,
} from "./vendorLandlordChoice.ts"
import {
  buildInvoiceReadyPaidConfirmationSms,
  invoiceReadyDetailsUrl,
  persistInvoicePaidConfirmationSms,
  type AwaitingInvoicePaidConfirmation,
} from "./sms/invoicePaidConfirmation.ts"

export type LandlordAttentionKind =
  | "invoice_ready"
  | "assign_vendor"
  | "workflow_escalated"
  | "late_rent"
  | "lease_renewal"
  | "lease_info_missing"
  | "unknown_occupant"
  | "external_vendor_replied"

export type NotifyLandlordAttentionParams = {
  landlordId: string
  kind: LandlordAttentionKind
  /** Plain-language event line, e.g. "No vendor found — leaking kitchen faucet". */
  headline: string
  /** Place, people, amount, or latest message — avoid internal IDs when possible. */
  detail: string
  idempotencyKey: string
  /** Address · unit · how recent, when known. */
  locationLine?: string | null
  /** Why this landed on them, in one sentence. */
  whyLine?: string | null
  /** Numbered next steps. Defaults from kind when omitted. */
  nextSteps?: string[]
  /** After numbered vendors: "Reply 1, 2, or 3 and we'll contact them." */
  choiceReplyHint?: string | null
  /** Persist 1/2/3 pending ask on the landlord SMS thread. */
  vendorChoice?: AwaitingVendorChoice | null
  maintenanceRequestId?: string | null
  workflowRunId?: string | null
  vendorId?: string | null
  unitId?: string | null
  residentId?: string | null
  propertyId?: string | null
}

export type NotifyLandlordAttentionResult = {
  skipped: boolean
  reason?: string
  smsSent: string[]
  emailSent: string[]
  errors: string[]
}

function attentionDashboardUrl(params: NotifyLandlordAttentionParams): string {
  const ticketId = params.maintenanceRequestId?.trim() ?? ""
  if (
    ticketId &&
    (params.kind === "assign_vendor" || params.kind === "external_vendor_replied")
  ) {
    return uloAppUrl.findExternalVendor(ticketId)
  }
  return uloAppUrl.admin()
}

function attentionEmailActionLabel(kind: LandlordAttentionKind): string {
  if (kind === "assign_vendor" || kind === "external_vendor_replied") {
    return "Open Find External Vendor"
  }
  if (kind === "invoice_ready") return "Review invoice"
  return "Open in Ulo"
}

export function defaultAttentionNextSteps(kind: LandlordAttentionKind): string[] {
  switch (kind) {
    case "assign_vendor":
      return []
    case "invoice_ready":
      return ["Review the invoice", "Pay in Ulo"]
    case "late_rent":
      return ["Review the account", "Follow up with the resident"]
    case "lease_renewal":
      return ["Review renewal options", "Reach out to the resident"]
    case "lease_info_missing":
      return ["Add lease dates or a copy in Ulo"]
    case "unknown_occupant":
      return ["Review who texted", "Confirm they should get updates"]
    case "external_vendor_replied":
      // Paid confirmation uses YES/NO in the body — no numbered reply options.
      return []
    default:
      return ["Open Ulo to decide next"]
  }
}

export function defaultAttentionWhyLine(kind: LandlordAttentionKind): string | null {
  switch (kind) {
    case "assign_vendor":
      return "No one on your preferred list can take this right now."
    case "invoice_ready":
      return "The vendor finished the job and the invoice is ready."
    case "late_rent":
      return "This rent account needs a decision from you."
    case "lease_renewal":
      return "The resident has not responded, so this needs a decision from you."
    case "lease_info_missing":
      return "We don't have lease details on file to answer them."
    case "unknown_occupant":
      return "This person is not on the unit roster yet."
    case "external_vendor_replied":
      return "They wrote back on the job thread."
    default:
      return "This needs a decision from you."
  }
}

export function formatReportedAgo(
  iso: string | null | undefined,
  now = new Date(),
): string | null {
  const raw = (iso ?? "").trim()
  if (!raw) return null
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return null
  const hours = Math.max(0, Math.round((now.getTime() - at.getTime()) / 3_600_000))
  if (hours < 1) return "reported just now"
  if (hours === 1) return "reported 1h ago"
  if (hours < 48) return `reported ${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "reported 1 day ago" : `reported ${days} days ago`
}

export function shortRepairLabel(
  description: string | null | undefined,
  issueCategory?: string | null,
): string {
  const line = (description ?? "").trim().split("\n")[0]?.trim() ?? ""
  const cleaned = line.replace(/\s+/g, " ").replace(/[.;]+$/g, "")
  if (cleaned && cleaned.length <= 72 && !/^wo-/i.test(cleaned)) {
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1)
  }
  const cat = (issueCategory ?? "").trim().toLowerCase()
  if (cat && cat !== "other" && cat !== "general") return `${cat} repair`
  return "this repair"
}

export function formatAttentionLocationLine(parts: {
  street?: string | null
  building?: string | null
  unit?: string | null
  reportedAgo?: string | null
}): string {
  const place = (parts.street ?? "").trim() || (parts.building ?? "").trim()
  const unitRaw = (parts.unit ?? "").trim()
  const unitBit = unitRaw
    ? (/^unit\b/i.test(unitRaw) ? unitRaw : `Unit ${unitRaw}`)
    : ""
  const ago = (parts.reportedAgo ?? "").trim()
  return [place, unitBit, ago].filter(Boolean).join(" · ")
}

type AttentionCopyInput = {
  kind?: LandlordAttentionKind
  headline: string
  detail?: string | null
  locationLine?: string | null
  whyLine?: string | null
  nextSteps?: string[]
  choiceReplyHint?: string | null
  dashboardUrl: string
  actionLabel?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

  /** When set with kind invoice_ready, SMS uses YES/NO paid-confirmation copy. */
  invoicePaid?: {
    landlordFirstName?: string | null
    unit?: string | null
    vendorName?: string | null
    amount?: number | null
    jobHeadline?: string | null
  } | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function attentionCopyParts(input: AttentionCopyInput) {
  const headline = input.headline.trim()
  const locationLine =
    (input.locationLine ?? "").trim() || (input.detail ?? "").trim()
  const whyLine =
    (input.whyLine ?? "").trim() ||
    (input.kind ? defaultAttentionWhyLine(input.kind) ?? "" : "")
  const steps = input.nextSteps
    ? input.nextSteps.map((s) => s.trim()).filter(Boolean)
    : input.kind
      ? defaultAttentionNextSteps(input.kind)
      : []
  const numbered = steps.map((s, i) => `${i + 1} — ${s}`).join("\n")
  const choiceReplyHint = (input.choiceReplyHint ?? "").trim()
  return { headline, locationLine, whyLine, numbered, choiceReplyHint }
}

export function buildLandlordAttentionSms(input: AttentionCopyInput): string {
  if (input.kind === "invoice_ready" && input.invoicePaid) {
    return buildInvoiceReadyPaidConfirmationSms({
      landlordFirstName: input.invoicePaid.landlordFirstName,
      unit: input.invoicePaid.unit,
      vendorName: input.invoicePaid.vendorName,
      amount: input.invoicePaid.amount,
      jobHeadline: input.invoicePaid.jobHeadline,
      detailsUrl: input.dashboardUrl,
    })
  }
  const { headline, locationLine, whyLine, numbered, choiceReplyHint } =
    attentionCopyParts(input)
  return [
    `Ulo: ${headline}`,
    "",
    locationLine || null,
    whyLine || null,
    numbered ? `\n${numbered}` : null,
    choiceReplyHint ? `\n${choiceReplyHint}` : null,
    "",
    "Details:",
    input.dashboardUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

export function buildLandlordAttentionEmail(input: AttentionCopyInput): {
  subject: string
  text: string
  html: string
} {
  if (input.kind === "invoice_ready" && input.invoicePaid) {
    const sms = buildInvoiceReadyPaidConfirmationSms({
      landlordFirstName: input.invoicePaid.landlordFirstName,
      unit: input.invoicePaid.unit,
      vendorName: input.invoicePaid.vendorName,
      amount: input.invoicePaid.amount,
      jobHeadline: input.invoicePaid.jobHeadline,
      detailsUrl: input.dashboardUrl,
    })
    const actionLabel =
      input.actionLabel?.trim() || attentionEmailActionLabel("invoice_ready")
    const html = `<p>${escapeHtml(sms).replace(/\n/g, "<br>")}</p>
<p><a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#186179;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(actionLabel)}</a></p>
<p style="color:#6a7282;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:<br>${escapeHtml(input.dashboardUrl)}</p>`
    return {
      subject: "Ulo: Invoice ready",
      text: sms,
      html,
    }
  }

    numbered ? `\n${numbered}` : null,
    choiceReplyHint ? `\n${choiceReplyHint}` : null,
    "",
    "Details:",
    input.dashboardUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")

  const htmlSteps = numbered
    ? `<ol style="padding-left:1.2em;">${numbered
      .split("\n")
      .map((line) => line.replace(/^\d+\s—\s/, "").trim())
      .filter(Boolean)
      .map((s) => `<li>${escapeHtml(s)}</li>`)
      .join("")}</ol>`
    : ""

  const html = `<p><strong>Ulo: ${escapeHtml(headline)}</strong></p>
${locationLine ? `<p>${escapeHtml(locationLine)}</p>` : ""}
${whyLine ? `<p>${escapeHtml(whyLine)}</p>` : ""}
${htmlSteps}
${choiceReplyHint ? `<p>${escapeHtml(choiceReplyHint)}</p>` : ""}
<p><a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#186179;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(actionLabel)}</a></p>
<p style="color:#6a7282;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:<br>${escapeHtml(input.dashboardUrl)}</p>`

  return { subject: `Ulo: ${headline}`, text, html }
}

async function alreadyAlerted(
  supabase: SupabaseClient,
  landlordId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("operations_graph_events")
    .select("id, metadata")
    .eq("landlord_id", landlordId)
    .eq("event_type", "landlord.attention_alert_sent")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40)

  if (error) {
    console.warn("[landlord-attention] idempotency lookup", error.message)
    return false
  }

  for (const row of data ?? []) {
    const meta = row.metadata as Record<string, unknown> | null
    if (meta?.idempotency_key === idempotencyKey) return true
  }
  return false
}

/**
 * Send SMS and/or email when an item is added to Needs Your Attention.
 * Idempotent on `idempotencyKey` (14-day window).
 */
export async function notifyLandlordNeedsAttention(
  supabase: SupabaseClient,
  params: NotifyLandlordAttentionParams,
): Promise<NotifyLandlordAttentionResult> {
  const landlordId = params.landlordId.trim()
  if (!landlordId) {
    return {
      skipped: true,
      reason: "missing_landlord",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  const key = params.idempotencyKey.trim()
  if (!key) {
    return {
      skipped: true,
      reason: "missing_idempotency_key",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  if (await alreadyAlerted(supabase, landlordId, key)) {
    return {
      skipped: true,
      reason: "already_sent",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  const [notificationSettings, operationalSettings] = await Promise.all([
    loadLandlordNotificationSettings(supabase, landlordId),
    loadLandlordOperationalSettings(supabase, landlordId),
  ])
  const deliveryPlan = resolveLandlordNotificationDelivery({
    settings: notificationSettings,
    attentionKind: params.kind,
    timeZone: operationalSettings.timeZone,
    quietHoursEnabled: operationalSettings.quietHoursEnabled,
  })
  if (!deliveryPlan.allowed) {
    return {
      skipped: true,
      reason: deliveryPlan.reason ?? "notifications_blocked",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  const allowSms = deliveryPlan.channels.includes("sms")
  const allowEmail = deliveryPlan.channels.includes("email")

  const dashboardUrl = attentionDashboardUrl(params)
  const copy = {
    kind: params.kind,
    headline: params.headline,
    detail: params.detail,
    locationLine: params.locationLine,
    whyLine: params.whyLine,
    nextSteps: params.nextSteps,
    choiceReplyHint: params.choiceReplyHint,
    dashboardUrl,
    actionLabel: attentionEmailActionLabel(params.kind),

  let landlordFirstName = params.landlordFirstName?.trim() || null
  if (params.kind === "invoice_ready" && !landlordFirstName) {
    try {
      const { data: landlord } = await supabase
        .from("landlords")
        .select("name")
        .eq("id", landlordId)
        .maybeSingle()
      const raw = typeof landlord?.name === "string" ? landlord.name.trim() : ""
      landlordFirstName = raw ? (raw.split(/\s+/)[0] ?? null) : null
    } catch {
      landlordFirstName = null
    }
  }

  const invoicePaid =
    params.kind === "invoice_ready" && params.invoicePaidConfirmation
      ? {
        landlordFirstName,
        unit: params.invoicePaidConfirmation.unit,
        vendorName: params.invoicePaidConfirmation.vendorName,
        amount: params.invoicePaidConfirmation.amount,
        jobHeadline: params.invoicePaidConfirmation.jobHeadline,
      }
      : null

  const copy = {
    kind: params.kind,
    headline: params.headline,
    detail: params.detail,
    locationLine: params.locationLine,
    whyLine: params.whyLine,
    nextSteps: params.nextSteps,
    choiceReplyHint: params.choiceReplyHint,
    dashboardUrl,
    actionLabel: attentionEmailActionLabel(params.kind),
    invoicePaid,
  }
  const smsBody = buildLandlordAttentionSms(copy)
  const email = buildLandlordAttentionEmail(copy)

  const errors: string[] = []
  const smsSent: string[] = []
  const emailSent: string[] = []

  const phones = allowSms
    ? (await resolveLandlordOpsPhones(supabase, landlordId)).phones
    : []
  if (allowSms && phones.length > 0) {
    const sender = await findActiveLandlordMainNumber(supabase, landlordId)
    const from = sender?.phone_number?.trim() || undefined
    if (!sender || !from) {
      errors.push("no_landlord_main_sms")
      console.warn("[landlord-attention] no landlord_main SMS number", landlordId)
    } else {
      const provider = getSMSProviderForSend({
        landlordId,
        lineProvider: sender.provider,
      })
      for (const to of phones) {
        const send = await provider.sendMessage({ to, body: smsBody, from })
        if (send.error) {
          errors.push(`sms:${to}:${send.error}`)
          console.error("[landlord-attention] SMS failed", to, send.error)
          continue
        }
        smsSent.push(to)
        const providerMessageSid =
          send.providerMessageSid ??
          send.messageId ??
          `landlord-attention:${key}:${to}`
        const providerName = send.provider ?? "twilio"

        // Invoice-ready: always mirror outbound into the landlord thread and
        // set awaiting_invoice_paid_confirmation (not only when vendorChoice exists).
        if (params.invoicePaidConfirmation) {
          try {
            await persistInvoicePaidConfirmationSms(supabase, {
              landlordId,
              phone: to,
              body: smsBody,
              awaiting: params.invoicePaidConfirmation,
              providerMessageSid,
              provider: providerName,
              fromNumber: from,
            })
          } catch (e) {
            console.error("[landlord-attention] persist invoice paid ask", e)
          }
          continue
        }

        const awaiting = params.vendorChoice
        if (awaiting && awaiting.options.length > 0) {
          try {
            await persistLandlordChoiceSms(supabase, {
              landlordId,
              phone: to,
              body: smsBody,
              awaiting,
              providerMessageSid,
              provider: providerName,
  if (allowEmail) {
    const mail = await sendLandlordOpsEmail(supabase, {
      landlordId,
      subject: email.subject,
      text: email.text,
      html: email.html,
      accountHolderOnly: true,
      logLabel: `attention:${params.kind}:${key}`,
    })
    emailSent.push(...mail.sent)
    for (const e of mail.errors) errors.push(`email:${e}`)
  }

  if (smsSent.length === 0 && emailSent.length === 0) {
    console.warn("[landlord-attention] no delivery", {
      landlordId,
      kind: params.kind,
      errors,
    })
    return { skipped: false, smsSent, emailSent, errors }
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "landlord.attention_alert_sent",
      source: "automation",
      actor_type: "system",
      maintenance_request_id: params.maintenanceRequestId ?? null,
      workflow_run_id: params.workflowRunId ?? null,
      vendor_id: params.vendorId ?? null,
      unit_id: params.unitId ?? null,
      resident_id: params.residentId ?? null,
      property_id: params.propertyId ?? null,
      metadata: {
        kind: params.kind,
        headline: params.headline,
        detail: params.detail,
        idempotency_key: key,
        sms_sent: smsSent,
        email_sent: emailSent,
        channels: [
          ...(smsSent.length ? ["sms"] : []),
          ...(emailSent.length ? ["email"] : []),
          "activity_feed",
        ],
        activity_feed: true,
      },
    })
  } catch (e) {
    console.error("[landlord-attention] graph", e)
  }

  return { skipped: false, smsSent, emailSent, errors }
}
