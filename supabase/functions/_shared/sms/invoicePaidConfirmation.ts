/**
 * Landlord YES/NO on "Have you paid this invoice?" attention SMS.
 * Pending ask: intake_state.awaiting_invoice_paid_confirmation.
 * YES → approveMaintenanceInvoice (source of truth for paid / recognized spend).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { titleCaseCompanyName, formatWorkOrderRef } from "../vendor_outreach_copy.ts"
import { uloAppUrl } from "../uloAppUrl.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { UNKNOWN_CONTACT_INTAKE_KEY } from "./unknownContactIntake.ts"
import { formatUnitReference } from "../properties/unitLabelDisplay.ts"

export type AwaitingInvoicePaidConfirmation = {
  invoiceId: string
  ticketId: string
  amount?: number | null
  unit?: string | null
  vendorName?: string | null
  jobHeadline?: string | null
}

export type InvoicePaidConfirmationReply = "paid" | "unpaid"

export function serializeAwaitingInvoicePaidConfirmation(
  awaiting: AwaitingInvoicePaidConfirmation,
): Record<string, unknown> {
  return {
    invoice_id: awaiting.invoiceId,
    ticket_id: awaiting.ticketId,
    amount: awaiting.amount ?? null,
    unit: awaiting.unit ?? null,
    vendor_name: awaiting.vendorName ?? null,
    job_headline: awaiting.jobHeadline ?? null,
  }
}

function parseAwaitingInvoicePaidRow(
  row: Record<string, unknown>,
): AwaitingInvoicePaidConfirmation | null {
  const invoiceId =
    (typeof row.invoice_id === "string" && row.invoice_id.trim()) ||
    (typeof row.invoiceId === "string" && row.invoiceId.trim()) ||
    ""
  const ticketId =
    (typeof row.ticket_id === "string" && row.ticket_id.trim()) ||
    (typeof row.ticketId === "string" && row.ticketId.trim()) ||
    ""
  if (!invoiceId || !ticketId) return null
  const amountRaw = row.amount
  const amount =
    typeof amountRaw === "number" && Number.isFinite(amountRaw)
      ? amountRaw
      : typeof amountRaw === "string" && amountRaw.trim()
        ? Number(amountRaw)
        : null
  return {
    invoiceId,
    ticketId,
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    unit: typeof row.unit === "string" ? row.unit : null,
    vendorName:
      (typeof row.vendor_name === "string" && row.vendor_name) ||
      (typeof row.vendorName === "string" && row.vendorName) ||
      null,
    jobHeadline:
      (typeof row.job_headline === "string" && row.job_headline) ||
      (typeof row.jobHeadline === "string" && row.jobHeadline) ||
      null,
  }
}

/** All pending invoice-paid asks (per invoice). Supports legacy single-object shape. */
export function readAwaitingInvoicePaidConfirmations(
  intakeState: unknown,
): AwaitingInvoicePaidConfirmation[] {
  if (!intakeState || typeof intakeState !== "object") return []
  const raw = (intakeState as Record<string, unknown>)
    .awaiting_invoice_paid_confirmation
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const root = raw as Record<string, unknown>
  const invoicesRaw = root.invoices
  if (invoicesRaw && typeof invoicesRaw === "object" && !Array.isArray(invoicesRaw)) {
    const out: AwaitingInvoicePaidConfirmation[] = []
    for (const value of Object.values(invoicesRaw as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      const parsed = parseAwaitingInvoicePaidRow(value as Record<string, unknown>)
      if (parsed) out.push(parsed)
    }
    return out
  }
  const legacy = parseAwaitingInvoicePaidRow(root)
  return legacy ? [legacy] : []
}

/** Sole pending ask, or first when several (prefer readAwaitingInvoicePaidConfirmations). */
export function readAwaitingInvoicePaidConfirmation(
  intakeState: unknown,
): AwaitingInvoicePaidConfirmation | null {
  const all = readAwaitingInvoicePaidConfirmations(intakeState)
  return all[0] ?? null
}

export function upsertAwaitingInvoicePaidConfirmation(
  priorIntake: Record<string, unknown>,
  awaiting: AwaitingInvoicePaidConfirmation,
): Record<string, unknown> {
  const invoices: Record<string, Record<string, unknown>> = {}
  for (const row of readAwaitingInvoicePaidConfirmations(priorIntake)) {
    invoices[row.invoiceId] = serializeAwaitingInvoicePaidConfirmation(row)
  }
  invoices[awaiting.invoiceId] = serializeAwaitingInvoicePaidConfirmation(awaiting)
  return {
    ...priorIntake,
    awaiting_invoice_paid_confirmation: { invoices },
  }
}

export function removeAwaitingInvoicePaidConfirmation(
  priorIntake: Record<string, unknown>,
  invoiceId: string,
): Record<string, unknown> {
  const invoices: Record<string, Record<string, unknown>> = {}
  for (const row of readAwaitingInvoicePaidConfirmations(priorIntake)) {
    if (row.invoiceId === invoiceId) continue
    invoices[row.invoiceId] = serializeAwaitingInvoicePaidConfirmation(row)
  }
  const next = { ...priorIntake }
  if (Object.keys(invoices).length === 0) {
    delete next.awaiting_invoice_paid_confirmation
  } else {
    next.awaiting_invoice_paid_confirmation = { invoices }
  }
  return next
}

export function invoicePaidConfirmationResolvedIntake(
  priorIntake: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...priorIntake }
  delete next.awaiting_invoice_paid_confirmation
  return next
}

export function canHandleInvoicePaidConfirmation(input: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (input.identityType === "vendor") return false
  return readAwaitingInvoicePaidConfirmations(input.intakeState).length > 0
}

function formatInvoiceAmount(amount: number | null | undefined): string {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return "$—"
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

export function buildWhichInvoicePaidAskSms(
  pending: AwaitingInvoicePaidConfirmation[],
): string {
  const lines = pending.map((p) => {
    const wo = formatWorkOrderRef(p.ticketId)
    const amount = formatInvoiceAmount(p.amount)
    return `• ${wo} (${amount})`
  })
  return [
    "You have more than one invoice waiting for a paid confirmation.",
    "Which did you mean?",
    ...lines,
    "",
    "Reply with the work order (e.g. WO-B347) plus YES or NO.",
  ].join("\n")
}

export function buildInvoicePaidMarkedSms(input: {
  ticketId: string
  amount?: number | null
}): string {
  const wo = formatWorkOrderRef(input.ticketId)
  const amount = formatInvoiceAmount(input.amount)
  return `Marked ${wo} (${amount}) as paid.`
}

export function buildAmbiguousYesPendingAsksSms(): string {
  return [
    "You have more than one yes/no question waiting.",
    "Reply with what you mean — for example which vendor to send, which invoice you paid, or which rent payment to confirm — so we don't guess.",
  ].join("\n")
}

/** True when body is a bare YES-equivalent (conflicts with other pending YES asks). */
export function isBareYesInvoicePaidReply(body: string): boolean {
  const normalized = body
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
  return (
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "yeah" ||
    normalized === "yep"
  )
}

/**
 * YES / paid / done — and NO / not yet — with reasonable equivalents.
 * Bare numbered replies like "1" are not paid confirmations (legacy fake options).
 * Work-order prefixes are stripped so "WO-B347 YES" / "YES WO-B347" count.
 */
export function parseInvoicePaidConfirmationReply(
  body: string,
): InvoicePaidConfirmationReply | null {
  let normalized = body
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
  if (!normalized) return null

  // Strip WO-XXXX / bare 8-char hex ticket prefixes so named YES/NO still parse.
  normalized = normalized
    .replace(/\bwo-?[0-9a-f]{4,8}\b/gi, " ")
    .replace(/\b[0-9a-f]{8}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "yeah" ||
    normalized === "yep" ||
    normalized === "paid" ||
    normalized === "done" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "already paid" ||
    normalized === "mark paid" ||
    normalized === "yes paid" ||
    normalized === "paid yes" ||
    normalized === "all paid" ||
    normalized === "it's paid" ||
    normalized === "its paid" ||
    normalized === "i paid" ||
    normalized === "i've paid" ||
    normalized === "ive paid"
  ) {
    return "paid"
  }

  if (
    normalized === "no" ||
    normalized === "n" ||
    normalized === "nope" ||
    normalized === "not yet" ||
    normalized === "not paid" ||
    normalized === "unpaid" ||
    normalized === "no unpaid" ||
    normalized === "haven't paid" ||
    normalized === "havent paid" ||
    normalized === "still unpaid" ||
    normalized === "not yet paid"
  ) {
    return "unpaid"
  }

  return null
}

export function unclearInvoicePaidConfirmationReply(): string {
  return "Please reply YES if you have paid this invoice, or NO if not yet."
}

export function cleanInvoiceJobHeadline(
  description: string | null | undefined,
  issueCategory?: string | null,
  issueHeadline?: string | null,
): string {
  const fromHeadline = (issueHeadline ?? "").trim().replace(/\s+/g, " ")
  if (fromHeadline && fromHeadline.length <= 72 && !/^wo-/i.test(fromHeadline)) {
    return fromHeadline.charAt(0).toUpperCase() + fromHeadline.slice(1)
  }
  const line = (description ?? "").trim().split("\n")[0]?.trim() ?? ""
  const cleaned = line.replace(/\s+/g, " ").replace(/[.;]+$/g, "")
  if (cleaned && cleaned.length <= 72 && !/^wo-/i.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }
  const cat = (issueCategory ?? "").trim().toLowerCase()
  if (cat && cat !== "other" && cat !== "general") {
    return `${cat.charAt(0).toUpperCase() + cat.slice(1)} repair`
  }
  return "This repair"
}

export function buildInvoiceReadyPaidConfirmationSms(input: {
  landlordFirstName?: string | null
  unit?: string | null
  propertyType?: string | null
  propertyLabel?: string | null
  vendorName?: string | null
  amount?: number | null
  jobHeadline?: string | null
  detailsUrl: string
}): string {
  const first = (input.landlordFirstName ?? "").trim() || "there"
  const unitBit = formatUnitReference(input.unit, input.propertyType) ||
    (input.propertyLabel ?? "").trim() ||
    "This home"
  const vendor =
    titleCaseCompanyName(input.vendorName) || "Vendor"
  const amount = formatInvoiceAmount(input.amount)
  const job = (input.jobHeadline ?? "").trim() || "This repair"

  return [
    `Hi ${first} — invoice ready`,
    "",
    `${unitBit} · ${vendor} · ${amount}`,
    `Job: ${job}`,
    "",
    "Have you paid this invoice?",
    "Reply YES if paid, or NO if not yet.",
    "",
    "Details:",
    input.detailsUrl,
  ].join("\n")
}

export function invoiceReadyDetailsUrl(ticketId: string): string {
  const id = ticketId.trim()
  if (!id) return uloAppUrl.admin()
  return uloAppUrl.adminWorkOrder(formatWorkOrderRef(id))
}

export async function persistInvoicePaidConfirmationSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    phone: string
    body: string
    awaiting: AwaitingInvoicePaidConfirmation
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

  const ticketId = params.awaiting.ticketId
  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: main.id,
    externalPhone: params.phone,
    identity,
    maintenanceRequestId: ticketId,
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
      source: "landlord_invoice_paid_confirmation",
      invoice_id: params.awaiting.invoiceId,
      ticket_id: ticketId,
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
  const nextIntake = { ...prior }
  delete nextIntake[UNKNOWN_CONTACT_INTAKE_KEY]

  await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      conversation_type: "landlord_update",
      maintenance_request_id: ticketId,
      intake_state: upsertAwaitingInvoicePaidConfirmation(
        nextIntake,
        params.awaiting,
      ),
    })
    .eq("id", conversationId)
}

async function clearOneAwaitingInvoicePaidConfirmation(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
  invoiceId: string,
): Promise<void> {
  const next = removeAwaitingInvoicePaidConfirmation(priorIntake, invoiceId)
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

function matchPendingInvoiceFromBody(
  body: string,
  pending: AwaitingInvoicePaidConfirmation[],
): AwaitingInvoicePaidConfirmation | null {
  if (pending.length === 1) return pending[0]
  const upper = body.toUpperCase()
  for (const row of pending) {
    const wo = formatWorkOrderRef(row.ticketId).toUpperCase()
    const short = row.ticketId.replace(/-/g, "").slice(0, 8).toUpperCase()
    if (wo && upper.includes(wo)) return row
    if (short.length >= 4 && upper.includes(short)) return row
  }
  return null
}

export async function tryHandleInvoicePaidConfirmationInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    messageId?: string | null
  },
): Promise<
  | { handled: false }
  | {
    handled: true
    action: "paid" | "unpaid" | "clarify"
    invoiceId: string
    ticketId: string
    replyBody: string
    recognizedAmount?: number
  }
> {
  if (params.identityType === "vendor") return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (!conv?.id) return { handled: false }

  const priorIntake =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  const pending = readAwaitingInvoicePaidConfirmations(priorIntake)
  if (pending.length === 0) return { handled: false }

  const parsed = parseInvoicePaidConfirmationReply(params.body)
  const matched = matchPendingInvoiceFromBody(params.body, pending)

  if (parsed != null && pending.length > 1 && !matched) {
    return {
      handled: true,
      action: "clarify",
      invoiceId: pending[0].invoiceId,
      ticketId: pending[0].ticketId,
      replyBody: buildWhichInvoicePaidAskSms(pending),
    }
  }

  const awaiting = matched ?? pending[0]

  if (parsed == null) {
    // Pending ask wins: claim the message so inboundFinish cannot invent a
    // generic maintenance fallback (the old "1" failure mode).
    return {
      handled: true,
      action: "clarify",
      invoiceId: awaiting.invoiceId,
      ticketId: awaiting.ticketId,
      replyBody: unclearInvoicePaidConfirmationReply(),
    }
  }

  if (parsed === "unpaid") {
    try {
      await recordActivityLog(supabase, {
        landlordId: params.landlordId,
        eventType: "maintenance.invoice_unpaid_confirmed",
        source: "sms",
        actorType: "landlord",
        maintenanceRequestId: awaiting.ticketId,
        metadata: {
          message: "Landlord confirmed the invoice is not paid yet.",
          invoice_id: awaiting.invoiceId,
          reply: params.body.trim().slice(0, 120),
        },
      })
    } catch (e) {
      console.error("[invoice-paid-confirm] unpaid log", e)
    }
    // Keep pending so a later YES can still mark paid.
    return {
      handled: true,
      action: "unpaid",
      invoiceId: awaiting.invoiceId,
      ticketId: awaiting.ticketId,
      replyBody:
        "Got it — we'll leave this invoice open. Reply YES when you've paid it, or pay in Ulo from the link above.",
    }
  }

  const { approveMaintenanceInvoice } = await import("../maintenanceSpend.ts")
  const approved = await approveMaintenanceInvoice(supabase, {
    invoiceId: awaiting.invoiceId,
    landlordId: params.landlordId,
    source: "sms",
  })

  if ("error" in approved) {
    if (approved.error === "invoice_not_found") {
      await clearOneAwaitingInvoicePaidConfirmation(
        supabase,
        params.conversationId,
        priorIntake,
        awaiting.invoiceId,
      )
      return {
        handled: true,
        action: "clarify",
        invoiceId: awaiting.invoiceId,
        ticketId: awaiting.ticketId,
        replyBody:
          "We couldn't find that invoice anymore. Open the details link above to review it in Ulo.",
      }
    }
    if (
      approved.error === "invoice_not_submittable" ||
      approved.error === "already_approved"
    ) {
      // Already decided elsewhere — clear ask, don't re-approve.
      await clearOneAwaitingInvoicePaidConfirmation(
        supabase,
        params.conversationId,
        priorIntake,
        awaiting.invoiceId,
      )
      return {
        handled: true,
        action: "paid",
        invoiceId: awaiting.invoiceId,
        ticketId: awaiting.ticketId,
        replyBody:
          approved.error === "already_approved"
            ? buildInvoicePaidMarkedSms({
              ticketId: awaiting.ticketId,
              amount: awaiting.amount,
            })
            : "This invoice is no longer waiting for payment confirmation. You can review it in Ulo.",
      }
    }
    console.error("[invoice-paid-confirm] approve failed", approved.error)
    return {
      handled: true,
      action: "clarify",
      invoiceId: awaiting.invoiceId,
      ticketId: awaiting.ticketId,
      replyBody:
        "We couldn't mark that invoice paid just now. Please try again or open the details link in Ulo.",
    }
  }

  await clearOneAwaitingInvoicePaidConfirmation(
    supabase,
    params.conversationId,
    priorIntake,
    awaiting.invoiceId,
  )

  const amount = approved.recognizedAmount
  return {
    handled: true,
    action: "paid",
    invoiceId: awaiting.invoiceId,
    ticketId: awaiting.ticketId,
    recognizedAmount: amount,
    replyBody: buildInvoicePaidMarkedSms({
      ticketId: awaiting.ticketId,
      amount,
    }),
  }
}
