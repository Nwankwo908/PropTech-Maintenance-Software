/**
 * After a positive resident rating, text the landlord invoice payment options
 * (card / BNPL / ACH / dashboard review).
 *
 * UNUSED / UNWIRED — no production call sites. Do not wire this as a second
 * reply contract on the same invoice thread without an explicit sequencing
 * decision (invoice_ready paid-confirmation YES/NO owns the ask today).
 * Kept for reference only; prefer deleting once product confirms payment
 * options SMS is not needed.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { getSMSProviderForSend } from "./sms/providerFactory.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import { logOutboundNoLandlordMain } from "./sms/logOutboundNoLandlordMain.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"
import { uloAppUrl } from "./uloAppUrl.ts"
import { landlordHasPayments } from "../../../shared/landlordCapabilities.ts"
import {
  landlordRecipients,
  recordSmsNoRecipients,
} from "./smsRecipients.ts"

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

export function buildLandlordInvoicePaymentSms(input: {
  workOrderRef: string
  vendorName: string
  totalCost: number
  unit: string
}): string {
  const dashboard = uloAppUrl.admin("analytics")
  return [
    `Invoice ready for ${input.workOrderRef}${input.unit ? ` (Unit ${input.unit})` : ""}.`,
    `${input.vendorName} · ${money(input.totalCost)}`,
    "",
    "How would you like to pay?",
    "Reply 1 — Pay now (card)",
    "Reply 2 — Pay later (BNPL)",
    "Reply 3 — Pay by ACH / bank",
    "Reply 4 — Review in dashboard",
    "",
    dashboard,
  ].join("\n")
}

/**
 * @deprecated UNUSED — no call sites. Do not invoke for live invoices; the
 * invoice_ready paid-confirmation YES/NO ask is the active landlord reply
 * contract. See file header.
 */
export async function notifyLandlordInvoicePaymentOptions(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    vendorId: string
    vendorName: string
    unit: string
    totalCost: number
    invoiceId?: string | null
    dryRun?: boolean
  },
): Promise<{ phones: string[]; body: string; sent: boolean }> {
  const empty = { phones: [] as string[], body: "", sent: false }
  if (!landlordHasPayments(params.landlordId)) {
    return empty
  }
  const { phones } = await landlordRecipients(supabase, params.landlordId)
  const body = buildLandlordInvoicePaymentSms({
    workOrderRef: formatWorkOrderRef(params.ticketId),
    vendorName: params.vendorName,
    totalCost: params.totalCost,
    unit: params.unit,
  })
  if (phones.length === 0) {
    await recordSmsNoRecipients({
      supabase,
      landlordId: params.landlordId,
      caller: "invoicePaymentSms.notifyLandlordInvoicePaymentOptions",
      messageType: "landlord_invoice_payment_options",
      maintenanceRequestId: params.ticketId,
      dryRun: params.dryRun,
    })
    return { phones, body, sent: false }
  }

  if (params.dryRun) {
    return { phones, body, sent: false }
  }

  const sender = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!sender?.phone_number) {
    console.warn("[invoice-payment-sms] no landlord_main SMS number")
    await logOutboundNoLandlordMain(supabase, {
      landlordId: params.landlordId,
      messageType: "landlord_invoice_payment_notify",
      resolver: "findActiveLandlordMainNumber",
      ticketId: params.ticketId,
    })
    return { phones, body, sent: false }
  }

  const provider = getSMSProviderForSend({
    landlordId: params.landlordId,
    lineProvider: sender.provider,
  })
  let sentAny = false
  for (const to of phones) {
    const send = await provider.sendMessage({
      to,
      body,
      from: sender.phone_number,
    })
    if (send.error) {
      console.error("[invoice-payment-sms] send failed", to, send.error)
      continue
    }
    sentAny = true
    try {
      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: "maintenance.invoice_payment_options_sent",
        source: "edge_function",
        actor_type: "system",
        vendor_id: params.vendorId,
        maintenance_request_id: params.ticketId,
        metadata: {
          to,
          total_cost: params.totalCost,
          invoice_id: params.invoiceId ?? null,
          provider_message_sid: send.providerMessageSid ?? null,
          options: ["card", "bnpl", "ach", "dashboard"],
        },
      })
    } catch (e) {
      console.error("[invoice-payment-sms] graph", e)
    }
  }
  return { phones, body, sent: sentAny }
}

/** Map landlord reply 1–4 to a payment preference label. */
export function parseInvoicePaymentReply(
  body: string,
): "card" | "bnpl" | "ach" | "dashboard" | null {
  const t = body.trim()
  if (/^1\b/.test(t) || /\bcard\b/i.test(t)) return "card"
  if (/^2\b/.test(t) || /\bbnpl\b/i.test(t) || /\blater\b/i.test(t)) return "bnpl"
  if (/^3\b/.test(t) || /\bach\b/i.test(t) || /\bbank\b/i.test(t)) return "ach"
  if (/^4\b/.test(t) || /\bdashboard\b/i.test(t) || /\breview\b/i.test(t)) {
    return "dashboard"
  }
  return null
}

/**
 * Handle landlord replies to invoice payment-option SMS.
 * Matches landlord identity phones + a recent payment_options_sent graph event.
 */
export async function tryHandleInvoicePaymentInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    fromPhone: string
  },
): Promise<{ handled: false } | { handled: true; replyBody: string }> {
  const fromDigits = params.fromPhone.replace(/\D/g, "")
  if (!fromDigits) return { handled: false }

  const { phones } = await landlordRecipients(supabase, params.landlordId)
  const allowed = new Set(
    phones.map((p) => p.replace(/\D/g, "")).filter(Boolean),
  )
  if (![...allowed].some((d) => d === fromDigits || d.endsWith(fromDigits) || fromDigits.endsWith(d))) {
    return { handled: false }
  }

  const preference = parseInvoicePaymentReply(params.body)
  if (!preference) return { handled: false }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabase
    .from("operations_graph_events")
    .select("maintenance_request_id, metadata")
    .eq("landlord_id", params.landlordId)
    .eq("event_type", "maintenance.invoice_payment_options_sent")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const ticketId =
    typeof recent?.maintenance_request_id === "string"
      ? recent.maintenance_request_id
      : null

  try {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.invoice_payment_preference",
      source: "sms",
      actor_type: "landlord",
      maintenance_request_id: ticketId,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      metadata: {
        preference,
        invoice_id:
          recent?.metadata &&
          typeof recent.metadata === "object" &&
          "invoice_id" in (recent.metadata as object)
            ? (recent.metadata as { invoice_id?: string }).invoice_id ?? null
            : null,
      },
    })
  } catch (e) {
    console.error("[invoice-payment-sms] preference graph", e)
  }

  const ack =
    preference === "card"
      ? "Got it — we'll process card payment for this invoice."
      : preference === "bnpl"
      ? "Got it — BNPL / pay-later selected. We'll send financing next steps."
      : preference === "ach"
      ? "Got it — ACH / bank payment selected. We'll follow up with transfer details."
      : "Got it — open the admin dashboard to review and pay this invoice."

  return { handled: true, replyBody: ack }
}
