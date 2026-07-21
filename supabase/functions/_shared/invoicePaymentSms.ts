/**
 * After a positive resident rating, text the landlord invoice payment options
 * (card / BNPL / ACH / dashboard review).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { getSMSProvider } from "./sms/providerFactory.ts"
import { findActiveLandlordMainNumber } from "./sms/smsNumberPool.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"

function appBaseUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() ?? ""
  if (!raw) return "https://www.ulohome.io"
  const t = raw.replace(/\/$/, "")
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

function adminNotifyPhones(): string[] {
  const raw = Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ?? ""
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
}

export function buildLandlordInvoicePaymentSms(input: {
  workOrderRef: string
  vendorName: string
  totalCost: number
  unit: string
}): string {
  const dashboard = `${appBaseUrl()}/admin/analytics`
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
  },
): Promise<void> {
  const phones = adminNotifyPhones()
  if (phones.length === 0) {
    console.warn("[invoice-payment-sms] no SMS_ADMIN_NOTIFY_PHONES configured")
    return
  }

  const sender = await findActiveLandlordMainNumber(supabase, params.landlordId)
  if (!sender?.phone_number) {
    console.warn("[invoice-payment-sms] no landlord_main SMS number")
    return
  }

  const body = buildLandlordInvoicePaymentSms({
    workOrderRef: formatWorkOrderRef(params.ticketId),
    vendorName: params.vendorName,
    totalCost: params.totalCost,
    unit: params.unit,
  })

  const provider = getSMSProvider()
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

function adminNotifyPhoneSet(): Set<string> {
  return new Set(
    adminNotifyPhones().map((p) => p.replace(/\D/g, "")).filter(Boolean),
  )
}

/**
 * Handle landlord/admin replies to invoice payment-option SMS.
 * Matches by known admin notify phones + recent payment_options_sent graph event.
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
  if (!fromDigits || !adminNotifyPhoneSet().has(fromDigits)) {
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
