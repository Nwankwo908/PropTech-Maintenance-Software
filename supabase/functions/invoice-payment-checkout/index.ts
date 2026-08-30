/**
 * Create / complete Stripe Checkout for maintenance invoice payments.
 *
 * Actions:
 * - create: starts Checkout for a specific method (ach, apple_pay, klarna, afterpay, card)
 * - complete: verifies a paid session and approves the invoice
 *
 * Edge secrets: STRIPE_SECRET_KEY, ADMIN_REASSIGN_SECRET, APP_URL (optional)
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { approveMaintenanceInvoice } from "../_shared/maintenanceSpend.ts"
import { canReceivePayments } from "../_shared/paymentReadiness.ts"
import {
  isMaintenanceInvoicePaid,
  isMaintenanceInvoicePaidFromRow,
} from "../_shared/paymentSettlement.ts"
import {
  isStripeCheckoutSessionPaymentFailed,
  recordInvoicePaymentFailedActivity,
} from "../_shared/paymentActivityEvents.ts"
import { landlordHasPayments } from "../../../shared/landlordCapabilities.ts"
import {
  applicationFeeCents,
  isStripeConfigured,
  stripeForm,
  stripeGet,
} from "../_shared/stripeConnect.ts"
import { uloAppOrigin } from "../_shared/uloAppUrl.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PaymentMethod =
  | "apple_pay"
  | "ach"
  | "afterpay"
  | "klarna"
  | "card"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function appOrigin(req: Request, bodyOrigin?: string): string {
  return uloAppOrigin({
    returnOrigin: bodyOrigin,
    requestOrigin: req.headers.get("origin"),
    fallback: "http://localhost:5173",
  })
}

function normalizePaymentMethod(raw: string): PaymentMethod | null {
  const value = raw.trim()
  if (value === "paypal") return "ach"
  const allowed: PaymentMethod[] = [
    "apple_pay",
    "ach",
    "afterpay",
    "klarna",
    "card",
  ]
  return allowed.includes(value as PaymentMethod) ? (value as PaymentMethod) : null
}

function stripePaymentMethodTypes(method: PaymentMethod): string[] {
  switch (method) {
    case "ach":
      return ["us_bank_account"]
    case "klarna":
      return ["klarna"]
    case "afterpay":
      return ["afterpay_clearpay"]
    case "apple_pay":
    case "card":
      return ["card"]
  }
}

function methodLabel(method: PaymentMethod): string {
  switch (method) {
    case "apple_pay":
      return "Apple Pay"
    case "ach":
      return "ACH Direct Debit"
    case "afterpay":
      return "Afterpay"
    case "klarna":
      return "Klarna"
    case "card":
      return "Card"
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function formatPaymentSourceLabel(
  paymentMethod: Record<string, unknown> | null,
  fallbackMethod: string,
): string {
  if (!paymentMethod) {
    return methodLabel((fallbackMethod || "card") as PaymentMethod)
  }

  const type = typeof paymentMethod.type === "string" ? paymentMethod.type : ""
  const card = asRecord(paymentMethod.card)
  if (type === "card" && card) {
    const brand = typeof card.brand === "string"
      ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
      : "Card"
    const last4 = typeof card.last4 === "string" ? card.last4 : "••••"
    return `${brand} ···· ${last4}`
  }

  const bank = asRecord(paymentMethod.us_bank_account)
  if (type === "us_bank_account" && bank) {
    const bankName = typeof bank.bank_name === "string" && bank.bank_name.trim()
      ? bank.bank_name.trim()
      : "Bank account"
    const last4 = typeof bank.last4 === "string" ? bank.last4 : "••••"
    const accountType = typeof bank.account_type === "string" && bank.account_type.trim()
      ? ` ${bank.account_type.charAt(0).toUpperCase()}${bank.account_type.slice(1)}`
      : ""
    return `${bankName}${accountType} (•••• ${last4})`
  }

  if (type === "link") return "Link"
  if (type === "klarna") return "Klarna"
  if (type === "afterpay_clearpay") return "Afterpay"
  if (type === "paypal") return "PayPal"

  return methodLabel((fallbackMethod || "card") as PaymentMethod)
}

function formatTransactionId(paymentIntentId: string | null, sessionId: string): string {
  const raw = (paymentIntentId || sessionId).replace(/[^a-zA-Z0-9]/g, "")
  const suffix = raw.slice(-8).toUpperCase() || "PAYMENT"
  return `TXN-${suffix}-ULO`
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  const adminAuth = requireAdminReassignAuth(req, "[invoice-payment-checkout]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response


  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const action = typeof body.action === "string" ? body.action.trim() : "create"
  if (!isStripeConfigured()) {
    return jsonResponse(
      {
        error:
          "Stripe is not configured. Set the STRIPE_SECRET_KEY Edge secret, enable ACH Direct Debit / Klarna / Afterpay in the Stripe Dashboard, then redeploy invoice-payment-checkout.",
      },
      503,
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  if (action === "complete") {
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : ""
    const landlordId =
      typeof body.landlordId === "string" ? body.landlordId.trim() : ""
    if (!sessionId.startsWith("cs_")) {
      return jsonResponse({ error: "Missing or invalid sessionId" }, 400)
    }
    if (!landlordId || !uuidRe.test(landlordId)) {
      return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
    }
    if (!landlordHasPayments(landlordId)) {
      return jsonResponse({ error: "Payments are not available on this account." }, 403)
    }

    const retrieved = await stripeGet(
      `checkout/sessions/${encodeURIComponent(sessionId)}` +
        `?expand[]=payment_intent` +
        `&expand[]=payment_intent.payment_method` +
        `&expand[]=payment_intent.latest_charge`,
    )
    if (!retrieved.ok) {
      const err = retrieved.json.error as { message?: string } | undefined
      return jsonResponse(
        { error: err?.message ?? "Could not verify Stripe Checkout session" },
        retrieved.status >= 400 ? retrieved.status : 502,
      )
    }

    const metadata = (retrieved.json.metadata ?? {}) as Record<string, unknown>
    const invoiceIdFromMeta =
      typeof metadata.invoice_id === "string" ? metadata.invoice_id.trim() : ""

    if (isStripeCheckoutSessionPaymentFailed(retrieved.json)) {
      await recordInvoicePaymentFailedActivity(supabase, {
        landlordId,
        invoiceId: invoiceIdFromMeta || null,
        reason: String(retrieved.json.payment_status ?? "checkout_failed"),
      })
      return jsonResponse(
        { error: "Invoice payment failed. Please try again or use a different payment method." },
        402,
      )
    }

    const paymentStatus = String(retrieved.json.payment_status ?? "")
    if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
      // ACH may land as unpaid briefly; still require paid for invoice approval.
      if (paymentStatus !== "unpaid") {
        await recordInvoicePaymentFailedActivity(supabase, {
          landlordId,
          invoiceId: invoiceIdFromMeta || null,
          reason: paymentStatus || "unknown",
        })
        return jsonResponse(
          { error: `Payment not completed (status: ${paymentStatus || "unknown"})` },
          402,
        )
      }
      // For ACH, Checkout can return unpaid while processing — treat processing as success if PI exists.
      const piProbe = asRecord(retrieved.json.payment_intent)
      const piStatus = typeof piProbe?.status === "string" ? piProbe.status : ""
      if (!["processing", "succeeded", "requires_capture"].includes(piStatus)) {
        await recordInvoicePaymentFailedActivity(supabase, {
          landlordId,
          invoiceId: invoiceIdFromMeta || null,
          reason: piStatus || paymentStatus || "unknown",
        })
        return jsonResponse(
          { error: `Payment not completed (status: ${paymentStatus || "unknown"})` },
          402,
        )
      }
    }

    const invoiceId = invoiceIdFromMeta
    const metaLandlord =
      typeof metadata.landlord_id === "string" ? metadata.landlord_id.trim() : ""
    if (!invoiceId || !uuidRe.test(invoiceId)) {
      return jsonResponse({ error: "Checkout session is missing invoice metadata" }, 400)
    }
    if (metaLandlord && metaLandlord !== landlordId) {
      return jsonResponse({ error: "Forbidden" }, 403)
    }

    const existingPaid = await isMaintenanceInvoicePaid(supabase, {
      invoiceId,
      landlordId,
      stripeCheckoutSessionId: sessionId,
    })
    if (existingPaid.paid) {
      const { data: invoiceRow } = await supabase
        .from("maintenance_invoices")
        .select("vendor_id, metadata, total_cost")
        .eq("id", invoiceId)
        .maybeSingle()
      let vendorName = "Vendor"
      if (invoiceRow?.vendor_id) {
        const { data: vendor } = await supabase
          .from("vendors")
          .select("name")
          .eq("id", invoiceRow.vendor_id)
          .maybeSingle()
        if (vendor?.name) vendorName = String(vendor.name)
      }
      const existingMeta =
        invoiceRow?.metadata &&
          typeof invoiceRow.metadata === "object" &&
          !Array.isArray(invoiceRow.metadata)
          ? invoiceRow.metadata as Record<string, unknown>
          : {}
      const paidAt =
        typeof existingMeta.billing_logged_at === "string"
          ? existingMeta.billing_logged_at
          : new Date().toISOString()
      const existingNote =
        typeof existingMeta.payment_note === "string" && existingMeta.payment_note.trim()
          ? existingMeta.payment_note.trim()
          : null
      return jsonResponse({
        ok: true,
        invoiceId,
        sessionId,
        alreadyCompleted: true,
        recognizedAmount: Number(invoiceRow?.total_cost ?? 0),
        amountPaid: Number(invoiceRow?.total_cost ?? 0),
        vendorName,
        paidAt,
        ...(existingNote ? { note: existingNote } : {}),
      })
    }

    const fallbackMethod =
      typeof metadata.payment_method === "string" ? metadata.payment_method : "card"
    const note =
      typeof metadata.payment_note === "string" && metadata.payment_note.trim()
        ? metadata.payment_note.trim()
        : `Paid via Stripe Checkout (${methodLabel(fallbackMethod as PaymentMethod)})`

    const result = await approveMaintenanceInvoice(supabase, {
      invoiceId,
      landlordId,
      source: "dashboard",
    })

    if ("error" in result) {
      await recordInvoicePaymentFailedActivity(supabase, {
        landlordId,
        invoiceId,
        reason: result.error,
      })
      const status =
        result.error === "forbidden"
          ? 403
          : result.error === "invoice_not_found"
          ? 404
          : 409
      return jsonResponse({ error: result.error, note }, status)
    }

    const paymentIntent = asRecord(retrieved.json.payment_intent)
    const paymentIntentId =
      typeof paymentIntent?.id === "string"
        ? paymentIntent.id
        : typeof retrieved.json.payment_intent === "string"
          ? retrieved.json.payment_intent
          : null
    const paymentMethodObj = asRecord(paymentIntent?.payment_method)
    const latestCharge = asRecord(paymentIntent?.latest_charge)
    const receiptUrl =
      typeof latestCharge?.receipt_url === "string"
        ? latestCharge.receipt_url
        : null
    const amountTotal =
      typeof retrieved.json.amount_total === "number"
        ? retrieved.json.amount_total / 100
        : result.recognizedAmount
    const paidAtUnix =
      typeof retrieved.json.created === "number" ? retrieved.json.created : null
    const paidAt = paidAtUnix
      ? new Date(paidAtUnix * 1000).toISOString()
      : new Date().toISOString()

    let vendorName = "Vendor"
    const { data: invoiceRow } = await supabase
      .from("maintenance_invoices")
      .select("vendor_id, metadata")
      .eq("id", invoiceId)
      .maybeSingle()
    if (invoiceRow?.vendor_id) {
      const { data: vendor } = await supabase
        .from("vendors")
        .select("name")
        .eq("id", invoiceRow.vendor_id)
        .maybeSingle()
      if (vendor?.name) vendorName = String(vendor.name)
    }

    const sourceLabel = formatPaymentSourceLabel(paymentMethodObj, fallbackMethod)
    const transactionId = formatTransactionId(paymentIntentId, sessionId)
    const existingMeta =
      invoiceRow?.metadata &&
        typeof invoiceRow.metadata === "object" &&
        !Array.isArray(invoiceRow.metadata)
        ? invoiceRow.metadata as Record<string, unknown>
        : {}

    await supabase
      .from("maintenance_invoices")
      .update({
        metadata: {
          ...existingMeta,
          billing_event: "paid",
          billing_logged_at: paidAt,
          payment_source: sourceLabel,
          transaction_id: transactionId,
          receipt_url: receiptUrl,
          stripe_checkout_session_id: sessionId,
          stripe_payment_intent_id: paymentIntentId,
          payment_method: fallbackMethod,
          payment_note: note || null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId)

    return jsonResponse({
      ok: true,
      invoiceId,
      sessionId,
      paymentMethod: fallbackMethod,
      recognizedAmount: result.recognizedAmount,
      amountPaid: amountTotal,
      vendorName,
      sourceLabel,
      transactionId,
      paidAt,
      receiptUrl,
      note,
      stripePaymentIntentId: paymentIntentId,
    })
  }

  // action === create
  const invoiceId =
    typeof body.invoiceId === "string" ? body.invoiceId.trim() : ""
  const landlordId =
    typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  const paymentMethod = normalizePaymentMethod(
    typeof body.paymentMethod === "string" ? body.paymentMethod : "",
  )
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 500) : ""

  if (!invoiceId || !uuidRe.test(invoiceId)) {
    return jsonResponse({ error: "Missing or invalid invoiceId" }, 400)
  }
  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  if (!landlordHasPayments(landlordId)) {
    return jsonResponse({ error: "Payments are not available on this account." }, 403)
  }
  if (!paymentMethod) {
    return jsonResponse({ error: "Unsupported payment method" }, 400)
  }

  const { data: invoice, error: invErr } = await supabase
    .from("maintenance_invoices")
    .select(
      "id, landlord_id, status, total_cost, invoice_number, maintenance_request_id, vendor_id, metadata",
    )
    .eq("id", invoiceId)
    .maybeSingle()

  if (invErr || !invoice) {
    return jsonResponse({ error: "Invoice not found" }, 404)
  }
  if (String(invoice.landlord_id) !== landlordId) {
    return jsonResponse({ error: "Forbidden" }, 403)
  }
  if (isMaintenanceInvoicePaidFromRow(invoice).paid) {
    return jsonResponse(
      { error: "Invoice has already been paid" },
      409,
    )
  }
  if (String(invoice.status) !== "submitted") {
    return jsonResponse(
      { error: `Invoice is not payable (status: ${invoice.status})` },
      409,
    )
  }

  const amountCents = Math.round(Number(invoice.total_cost) * 100)
  if (!Number.isFinite(amountCents) || amountCents < 50) {
    return jsonResponse({ error: "Invoice amount is too small to charge" }, 400)
  }

  let vendorName = "Vendor"
  let connectAccountId = ""
  if (invoice.vendor_id) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", invoice.vendor_id)
      .maybeSingle()
    if (vendor?.name) vendorName = String(vendor.name)

    const { ready, destination } = await canReceivePayments(supabase, {
      party: "vendor",
      vendorId: String(invoice.vendor_id),
    })
    if (ready && destination) {
      connectAccountId = destination.accountId
    }
  }

  if (!invoice.vendor_id || !connectAccountId) {
    return jsonResponse(
      {
        error:
          "This vendor hasn't finished payout setup yet. Ask them to complete verification (Set up payouts) before paying this invoice online.",
      },
      409,
    )
  }

  const origin = appOrigin(
    req,
    typeof body.returnOrigin === "string" ? body.returnOrigin : undefined,
  )
  const successUrl =
    `${origin}/admin?invoice_payment=success` +
    `&session_id={CHECKOUT_SESSION_ID}` +
    `&invoice_id=${encodeURIComponent(invoiceId)}`
  const cancelUrl =
    `${origin}/admin?invoice_payment=cancel` +
    `&invoice_id=${encodeURIComponent(invoiceId)}` +
    `&method=${encodeURIComponent(paymentMethod)}`

  const invoiceLabel =
    typeof invoice.invoice_number === "string" && invoice.invoice_number.trim()
      ? invoice.invoice_number.trim()
      : `Invoice ${invoiceId.slice(0, 8)}`

  const params = new URLSearchParams()
  params.set("mode", "payment")
  params.set("success_url", successUrl)
  params.set("cancel_url", cancelUrl)
  params.set("client_reference_id", invoiceId)
  params.set("billing_address_collection", "auto")

  const types = stripePaymentMethodTypes(paymentMethod)
  types.forEach((type, i) => {
    params.set(`payment_method_types[${i}]`, type)
  })

  if (paymentMethod === "afterpay") {
    params.set("shipping_address_collection[allowed_countries][0]", "US")
    params.set("shipping_address_collection[allowed_countries][1]", "CA")
    params.set("shipping_address_collection[allowed_countries][2]", "GB")
    params.set("shipping_address_collection[allowed_countries][3]", "AU")
    params.set("shipping_address_collection[allowed_countries][4]", "NZ")
  }

  if (paymentMethod === "ach") {
    params.set(
      "payment_method_options[us_bank_account][financial_connections][permissions][0]",
      "payment_method",
    )
    params.set(
      "payment_method_options[us_bank_account][financial_connections][permissions][1]",
      "balances",
    )
  }

  params.set(
    "line_items[0][price_data][currency]",
    "usd",
  )
  params.set(
    "line_items[0][price_data][unit_amount]",
    String(amountCents),
  )
  params.set(
    "line_items[0][price_data][product_data][name]",
    `Maintenance invoice — ${vendorName}`,
  )
  params.set(
    "line_items[0][price_data][product_data][description]",
    `${invoiceLabel} · Paid via ${methodLabel(paymentMethod)}`,
  )
  params.set("line_items[0][quantity]", "1")

  params.set("metadata[invoice_id]", invoiceId)
  params.set("metadata[landlord_id]", landlordId)
  params.set("metadata[payment_method]", paymentMethod)
  params.set("metadata[maintenance_request_id]", String(invoice.maintenance_request_id ?? ""))
  params.set("metadata[vendor_id]", String(invoice.vendor_id ?? ""))
  params.set("metadata[stripe_connect_account_id]", connectAccountId)
  if (note) params.set("metadata[payment_note]", note)

  // Destination charge → vendor Express Connect account (optional platform fee).
  params.set(
    "payment_intent_data[transfer_data][destination]",
    connectAccountId,
  )
  const feeCents = applicationFeeCents(amountCents)
  if (feeCents > 0) {
    params.set(
      "payment_intent_data[application_fee_amount]",
      String(feeCents),
    )
  }

  // Prefer wallet UI when Apple Pay is selected (card Checkout still presents Apple Pay when eligible).
  if (paymentMethod === "apple_pay") {
    params.set("payment_method_options[card][request_three_d_secure]", "automatic")
  }

  const created = await stripeForm("checkout/sessions", params)
  if (!created.ok) {
    const err = created.json.error as { message?: string; code?: string } | undefined
    const message =
      err?.message ??
      "Stripe could not start checkout. Enable this payment method in the Stripe Dashboard (Settings → Payment methods)."
    return jsonResponse({ error: message, stripeCode: err?.code ?? null }, 502)
  }

  const url = typeof created.json.url === "string" ? created.json.url : null
  const sessionId = typeof created.json.id === "string" ? created.json.id : null
  if (!url || !sessionId) {
    return jsonResponse({ error: "Stripe did not return a checkout URL" }, 502)
  }

  return jsonResponse({
    ok: true,
    url,
    sessionId,
    paymentMethod,
    invoiceId,
  })
})
