/**
 * Stripe Checkout for maintenance invoice payments (ACH, Klarna, Afterpay, Apple Pay, card).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type InvoiceCheckoutPaymentMethod =
  | 'apple_pay'
  | 'ach'
  | 'afterpay'
  | 'klarna'
  | 'card'

function invoicePaymentCheckoutUrl(): string | undefined {
  const explicit = import.meta.env.VITE_INVOICE_PAYMENT_CHECKOUT_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (!base) return undefined
  return `${base.replace(/\/$/, '')}/functions/v1/invoice-payment-checkout`
}

async function postInvoicePaymentCheckout(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = invoicePaymentCheckoutUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error(
      "This feature isn't available right now. Please try again later.",
    )
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      ...body,
      landlordId: getActiveLandlordId(),
      returnOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
    }),
  })

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string' && json.error.trim()
        ? json.error.trim()
        : `Checkout failed (${res.status})`,
    )
  }
  return json
}

/** Start Stripe Checkout for the selected method; returns hosted checkout URL. */
export async function createInvoicePaymentCheckout(params: {
  invoiceId: string
  paymentMethod: InvoiceCheckoutPaymentMethod
  note?: string
}): Promise<{ url: string; sessionId: string }> {
  const json = await postInvoicePaymentCheckout({
    action: 'create',
    invoiceId: params.invoiceId,
    paymentMethod: params.paymentMethod,
    note: params.note,
  })

  const url = typeof json.url === 'string' ? json.url.trim() : ''
  const sessionId = typeof json.sessionId === 'string' ? json.sessionId.trim() : ''
  if (!url || !sessionId) {
    throw new Error('Checkout did not return a payment URL.')
  }
  return { url, sessionId }
}

/** After Stripe redirects back, verify payment and approve the invoice. */
export async function completeInvoicePaymentCheckout(params: {
  sessionId: string
}): Promise<{
  invoiceId: string
  recognizedAmount?: number
  amountPaid: number
  vendorName: string
  sourceLabel: string
  transactionId: string
  paidAt: string
  receiptUrl: string | null
}> {
  const json = await postInvoicePaymentCheckout({
    action: 'complete',
    sessionId: params.sessionId,
  })

  const invoiceId = typeof json.invoiceId === 'string' ? json.invoiceId.trim() : ''
  if (!invoiceId) {
    throw new Error('Payment completed but invoice id was missing.')
  }

  const amountPaid =
    typeof json.amountPaid === 'number'
      ? json.amountPaid
      : typeof json.recognizedAmount === 'number'
        ? json.recognizedAmount
        : 0

  return {
    invoiceId,
    recognizedAmount:
      typeof json.recognizedAmount === 'number' ? json.recognizedAmount : undefined,
    amountPaid,
    vendorName:
      typeof json.vendorName === 'string' && json.vendorName.trim()
        ? json.vendorName.trim()
        : 'Vendor',
    sourceLabel:
      typeof json.sourceLabel === 'string' && json.sourceLabel.trim()
        ? json.sourceLabel.trim()
        : 'Payment method',
    transactionId:
      typeof json.transactionId === 'string' && json.transactionId.trim()
        ? json.transactionId.trim()
        : `TXN-${invoiceId.slice(0, 8).toUpperCase()}-ULO`,
    paidAt:
      typeof json.paidAt === 'string' && json.paidAt.trim()
        ? json.paidAt.trim()
        : new Date().toISOString(),
    receiptUrl:
      typeof json.receiptUrl === 'string' && json.receiptUrl.trim()
        ? json.receiptUrl.trim()
        : null,
  }
}

export function paymentOptionIdToCheckoutMethod(
  optionId: string,
): InvoiceCheckoutPaymentMethod | null {
  switch (optionId) {
    case 'apple_pay':
    case 'ach':
    case 'afterpay':
    case 'klarna':
    case 'card':
      return optionId
    case 'paypal':
      return 'ach'
    default:
      return null
  }
}

export function paymentIconToCheckoutMethod(
  icon: string,
): InvoiceCheckoutPaymentMethod {
  switch (icon) {
    case 'apple':
      return 'apple_pay'
    case 'ach':
    case 'paypal':
      return 'ach'
    case 'afterpay':
      return 'afterpay'
    case 'klarna':
      return 'klarna'
    default:
      return 'card'
  }
}
