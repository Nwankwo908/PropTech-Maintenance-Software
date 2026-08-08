/**
 * Helper 2 — Was this specific rent charge or maintenance invoice paid?
 *
 * Reads rent_collection workflow runs or maintenance_invoices (client runtime).
 *
 * Architecture: settlement checks only — never write activity feed entries or
 * send notifications from this module. Callers record outcomes via
 * paymentActivityMessages.ts + recordActivityLog.
 */
import { supabase } from '@/lib/supabase'

export type RentChargePaidSource =
  | 'stripe_checkout'
  | 'admin_marked'
  | 'workflow_completed'
  | 'resident_reported'

export type RentChargePaidResult = {
  paid: boolean
  runId: string | null
  billingPeriod: string | null
  source: RentChargePaidSource | null
  stripeCheckoutSessionId: string | null
}

export type MaintenanceInvoicePaidSource = 'stripe_checkout' | 'admin_approved'

export type MaintenanceInvoicePaidResult = {
  paid: boolean
  invoiceId: string | null
  status: string | null
  source: MaintenanceInvoicePaidSource | null
  stripeCheckoutSessionId: string | null
}

type RentRunLike = {
  id: string
  template_id: string
  status: string
  metadata?: Record<string, unknown> | null
}

type InvoiceRowLike = {
  id?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readMetadata(run: { metadata?: unknown }): Record<string, unknown> {
  const meta = run.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {}
}

function runBillingPeriod(run: RentRunLike): string | null {
  return readString(readMetadata(run).billing_period)
}

export function isRentChargePaidFromRun(
  run: RentRunLike | null | undefined,
  options?: {
    billingPeriod?: string | null
    stripeCheckoutSessionId?: string | null
  },
): RentChargePaidResult {
  const empty: RentChargePaidResult = {
    paid: false,
    runId: null,
    billingPeriod: null,
    source: null,
    stripeCheckoutSessionId: null,
  }
  if (!run || run.template_id !== 'rent_collection') return empty

  const meta = readMetadata(run)
  const billingPeriod = runBillingPeriod(run) ?? readString(meta.billing_period)
  const sessionId =
    readString(meta.stripe_checkout_session_id) ??
    readString(
      (meta.step_state as Record<string, unknown> | undefined)?.stripe_checkout_session_id,
    )

  if (
    options?.billingPeriod?.trim() &&
    billingPeriod &&
    options.billingPeriod.trim() !== billingPeriod
  ) {
    return {
      ...empty,
      runId: run.id,
      billingPeriod,
      stripeCheckoutSessionId: sessionId,
    }
  }

  if (
    options?.stripeCheckoutSessionId?.trim() &&
    sessionId &&
    options.stripeCheckoutSessionId.trim() !== sessionId
  ) {
    return {
      ...empty,
      runId: run.id,
      billingPeriod,
      stripeCheckoutSessionId: sessionId,
    }
  }

  const paymentIntent =
    readString(meta.payment_intent) ??
    readString((meta.step_state as Record<string, unknown> | undefined)?.payment_intent)
  const rentClassification = readString(meta.rent_classification)
  const adminMarked = readString(meta.admin_payment_received_at)
  const stripeCompleted = readString(meta.stripe_payment_completed_at)
  const completed = run.status === 'completed'

  let source: RentChargePaidSource | null = null
  if (completed && stripeCompleted && sessionId) {
    source = 'stripe_checkout'
  } else if (completed && adminMarked) {
    source = 'admin_marked'
  } else if (
    completed &&
    (paymentIntent === 'paid' || rentClassification === 'paid')
  ) {
    source = stripeCompleted || sessionId
      ? 'stripe_checkout'
      : adminMarked
        ? 'admin_marked'
        : 'resident_reported'
  } else if (completed && rentClassification === 'paid') {
    source = 'workflow_completed'
  }

  return {
    paid: source !== null,
    runId: run.id,
    billingPeriod,
    source,
    stripeCheckoutSessionId: sessionId,
  }
}

export async function isRentChargePaid(params: {
  runId: string
  landlordId?: string | null
  billingPeriod?: string | null
  stripeCheckoutSessionId?: string | null
}): Promise<RentChargePaidResult> {
  const runId = params.runId.trim()
  if (!supabase || !runId) {
    return {
      paid: false,
      runId: runId || null,
      billingPeriod: params.billingPeriod ?? null,
      source: null,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
    }
  }

  let query = supabase
    .from('workflow_runs')
    .select('id, template_id, status, metadata, landlord_id')
    .eq('id', runId)
    .eq('template_id', 'rent_collection')

  const landlordId = params.landlordId?.trim()
  if (landlordId) query = query.eq('landlord_id', landlordId)

  const { data, error } = await query.maybeSingle()
  if (error || !data) {
    return {
      paid: false,
      runId,
      billingPeriod: params.billingPeriod ?? null,
      source: null,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
    }
  }

  return isRentChargePaidFromRun(data as RentRunLike, {
    billingPeriod: params.billingPeriod,
    stripeCheckoutSessionId: params.stripeCheckoutSessionId,
  })
}

export function isMaintenanceInvoicePaidFromRow(
  invoice: InvoiceRowLike | null | undefined,
  options?: { stripeCheckoutSessionId?: string | null },
): MaintenanceInvoicePaidResult {
  const empty: MaintenanceInvoicePaidResult = {
    paid: false,
    invoiceId: null,
    status: null,
    source: null,
    stripeCheckoutSessionId: null,
  }
  if (!invoice?.id) return empty

  const status = readString(invoice.status)?.toLowerCase() ?? null
  const meta = invoice.metadata ?? {}
  const sessionId = readString(meta.stripe_checkout_session_id)

  if (
    options?.stripeCheckoutSessionId?.trim() &&
    sessionId &&
    options.stripeCheckoutSessionId.trim() !== sessionId
  ) {
    return {
      ...empty,
      invoiceId: String(invoice.id),
      status,
      stripeCheckoutSessionId: sessionId,
    }
  }

  if (status !== 'approved') {
    return {
      paid: false,
      invoiceId: String(invoice.id),
      status,
      source: null,
      stripeCheckoutSessionId: sessionId,
    }
  }

  const source: MaintenanceInvoicePaidSource =
    sessionId || readString(meta.stripe_payment_intent_id)
      ? 'stripe_checkout'
      : 'admin_approved'

  return {
    paid: true,
    invoiceId: String(invoice.id),
    status,
    source,
    stripeCheckoutSessionId: sessionId,
  }
}

export async function isMaintenanceInvoicePaid(params: {
  invoiceId: string
  landlordId?: string | null
  stripeCheckoutSessionId?: string | null
}): Promise<MaintenanceInvoicePaidResult> {
  const invoiceId = params.invoiceId.trim()
  if (!supabase || !invoiceId) {
    return {
      paid: false,
      invoiceId: invoiceId || null,
      status: null,
      source: null,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
    }
  }

  let query = supabase
    .from('maintenance_invoices')
    .select('id, status, metadata, landlord_id')
    .eq('id', invoiceId)

  const landlordId = params.landlordId?.trim()
  if (landlordId) query = query.eq('landlord_id', landlordId)

  const { data, error } = await query.maybeSingle()
  if (error || !data) {
    return {
      paid: false,
      invoiceId,
      status: null,
      source: null,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
    }
  }

  return isMaintenanceInvoicePaidFromRow(data as InvoiceRowLike, {
    stripeCheckoutSessionId: params.stripeCheckoutSessionId,
  })
}
