/**
 * Payment business events — activity feed + landlord notifications.
 *
 * `paymentReadiness` and `paymentSettlement` answer internal questions only.
 * They must never write activity feed entries or send notifications.
 *
 * Call these helpers from workflows/features AFTER a real state change.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { sendLandlordOpsEmail } from "./landlordOpsNotify.ts"

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

/** e.g. "2026-07" → "July" */
export function formatRentBillingPeriodLabel(
  billingPeriod: string | null | undefined,
): string | null {
  const raw = readString(billingPeriod)
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})$/.exec(raw)
  if (match) {
    const date = new Date(`${match[1]}-${match[2]}-01T12:00:00`)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", { month: "long" }).format(date)
    }
  }
  return raw
}

export function buildRentPaymentReceivedMessage(params: {
  billingPeriod?: string | null
  residentName?: string | null
}): string {
  const period = formatRentBillingPeriodLabel(params.billingPeriod)
  const name = readString(params.residentName) ?? "Resident"
  if (period) {
    return `${period} rent payment received from ${name}.`
  }
  return `Rent payment received from ${name}.`
}

export function buildMaintenanceInvoicePaidMessage(params: {
  invoiceNumber?: string | null
  invoiceId?: string | null
}): string {
  const number = readString(params.invoiceNumber)
  if (number) return `Invoice #${number} was paid.`
  const id = readString(params.invoiceId)
  if (id) return `Invoice #${id.slice(0, 8)} was paid.`
  return "Maintenance invoice was paid."
}

async function notifyLandlordPaymentEmail(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    subject: string
    body: string
    logLabel: string
  },
): Promise<void> {
  try {
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: params.subject,
      text: params.body,
      html: `<p>${params.body}</p>`,
      logLabel: params.logLabel,
    })
  } catch (error) {
    console.error("[payment-activity]", params.logLabel, error)
  }
}

/** Landlord Connect NOT READY → READY (once). */
export async function recordLandlordStripeConnectReadyIfTransition(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    wasReady: boolean
    nowReady: boolean
  },
): Promise<void> {
  if (params.wasReady || !params.nowReady) return

  const message = "Online rent payments are now enabled."
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "payment.landlord_connect_ready",
    source: "dashboard",
    actorType: "landlord",
    metadata: { message },
  })

  await notifyLandlordPaymentEmail(supabase, {
    landlordId: params.landlordId,
    subject: "Online rent payments are enabled",
    body: "Your Stripe account has been verified. You can now accept online payments.",
    logLabel: "landlord_connect_ready",
  })
}

/** Vendor Connect NOT READY → READY (once). */
export async function recordVendorStripeConnectReadyIfTransition(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    verificationId?: string | null
    wasReady: boolean
    nowReady: boolean
    workflowRunId?: string | null
  },
): Promise<void> {
  if (params.wasReady || !params.nowReady) return

  const message = "Vendor is ready to receive online payments."
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "payment.vendor_connect_ready",
    source: "vendor_portal",
    actorType: "vendor",
    vendorId: params.vendorId,
    workflowRunId: params.workflowRunId ?? null,
    workflowTemplateId: params.workflowRunId ? "vendor_onboarding" : null,
    metadata: {
      message,
      verification_id: params.verificationId ?? null,
    },
  })

  await notifyLandlordPaymentEmail(supabase, {
    landlordId: params.landlordId,
    subject: "Vendor payment setup complete",
    body: "Vendor payment setup is complete.",
    logLabel: "vendor_connect_ready",
  })
}

/** Rent charge settled (Stripe checkout or equivalent). */
export async function recordRentPaymentReceivedActivity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    workflowRunId: string
    residentId?: string | null
    unitId?: string | null
    propertyId?: string | null
    billingPeriod?: string | null
    residentName?: string | null
    source?: "stripe_checkout" | "dashboard" | "automation"
    notifyLandlord?: boolean
  },
): Promise<string | null> {
  const message = buildRentPaymentReceivedMessage({
    billingPeriod: params.billingPeriod,
    residentName: params.residentName,
  })

  const eventId = await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "rent.payment_received",
    source: params.source === "dashboard" ? "dashboard" : "automation",
    actorType: params.source === "dashboard" ? "landlord" : "resident",
    residentId: params.residentId ?? null,
    unitId: params.unitId ?? null,
    propertyId: params.propertyId ?? null,
    workflowRunId: params.workflowRunId,
    workflowTemplateId: "rent_collection",
    metadata: { message },
  })

  if (params.notifyLandlord === true) {
    await notifyLandlordPaymentEmail(supabase, {
      landlordId: params.landlordId,
      subject: "Rent payment received",
      body: message,
      logLabel: "rent_payment_received",
    })
  }

  return eventId
}

/** Maintenance invoice paid / approved after settlement. */
export async function recordMaintenanceInvoicePaidActivity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    invoiceId: string
    invoiceNumber?: string | null
    maintenanceRequestId?: string | null
    vendorId?: string | null
    unitId?: string | null
    propertyId?: string | null
    residentId?: string | null
    source?: "dashboard" | "automation"
  },
): Promise<string | null> {
  const message = buildMaintenanceInvoicePaidMessage({
    invoiceNumber: params.invoiceNumber,
    invoiceId: params.invoiceId,
  })

  return recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.invoice_paid",
    source: params.source === "dashboard" ? "dashboard" : "automation",
    actorType: params.source === "dashboard" ? "landlord" : "system",
    maintenanceRequestId: params.maintenanceRequestId ?? null,
    vendorId: params.vendorId ?? null,
    unitId: params.unitId ?? null,
    propertyId: params.propertyId ?? null,
    residentId: params.residentId ?? null,
    metadata: {
      message,
      invoice_id: params.invoiceId,
      invoice_number: params.invoiceNumber ?? null,
    },
  })
}

/** Stripe rent checkout failed or could not settle. */
export async function recordRentPaymentFailedActivity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    workflowRunId?: string | null
    residentId?: string | null
    unitId?: string | null
    propertyId?: string | null
    reason?: string | null
  },
): Promise<string | null> {
  const message = "Rent payment failed."
  const eventId = await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "rent.payment_failed",
    source: "automation",
    actorType: "system",
    residentId: params.residentId ?? null,
    unitId: params.unitId ?? null,
    propertyId: params.propertyId ?? null,
    workflowRunId: params.workflowRunId ?? null,
    workflowTemplateId: params.workflowRunId ? "rent_collection" : null,
    metadata: {
      message,
      reason: params.reason ?? null,
    },
  })

  await notifyLandlordPaymentEmail(supabase, {
    landlordId: params.landlordId,
    subject: "Rent payment failed",
    body: [
      message,
      params.reason?.trim() ? params.reason.trim() : null,
      "",
      "Review the rent collection workflow in Ulo when you have a moment.",
    ].filter((line): line is string => line != null).join("\n"),
    logLabel: "rent_payment_failed",
  })

  return eventId
}

/** Stripe invoice checkout failed or approval could not complete. */
export async function recordInvoicePaymentFailedActivity(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    invoiceId?: string | null
    invoiceNumber?: string | null
    maintenanceRequestId?: string | null
    vendorId?: string | null
    reason?: string | null
  },
): Promise<string | null> {
  const message = "Invoice payment failed."
  const eventId = await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.invoice_payment_failed",
    source: "dashboard",
    actorType: "landlord",
    maintenanceRequestId: params.maintenanceRequestId ?? null,
    vendorId: params.vendorId ?? null,
    metadata: {
      message,
      invoice_id: params.invoiceId ?? null,
      invoice_number: params.invoiceNumber ?? null,
      reason: params.reason ?? null,
    },
  })

  await notifyLandlordPaymentEmail(supabase, {
    landlordId: params.landlordId,
    subject: "Invoice payment failed",
    body: [
      message,
      params.reason?.trim() ? params.reason.trim() : null,
      "",
      "You may need to retry payment or contact the vendor.",
    ].filter((line): line is string => line != null).join("\n"),
    logLabel: "invoice_payment_failed",
  })

  return eventId
}

export function isStripeCheckoutSessionPaymentFailed(session: {
  payment_status?: unknown
  payment_intent?: unknown
}): boolean {
  const paymentStatus = readString(session.payment_status)?.toLowerCase()
  if (paymentStatus === "unpaid") {
    const pi = session.payment_intent
    const piRecord = pi && typeof pi === "object" && !Array.isArray(pi)
      ? pi as Record<string, unknown>
      : null
    const piStatus = readString(piRecord?.status)?.toLowerCase()
    if (piStatus === "requires_payment_method" || piStatus === "canceled") {
      return true
    }
  }
  return paymentStatus === "failed"
}
