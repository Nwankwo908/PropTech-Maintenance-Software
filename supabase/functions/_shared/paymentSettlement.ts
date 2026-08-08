/**
 * Helper 2 — Was this specific rent charge or maintenance invoice paid?
 *
 * Reads the existing rent_collection workflow run or maintenance_invoices row.
 * Rent and invoice stay separate products; do not merge settlement checks.
 *
 * Architecture: settlement checks only — never write activity feed entries or
 * send notifications from this module. Callers use paymentActivityEvents.ts
 * after confirming a real payment outcome.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  runBillingPeriod,
  type WorkflowRunRow,
} from "./engine/workflowRuns.ts"

export type RentChargePaidSource =
  | "stripe_checkout"
  | "admin_marked"
  | "workflow_completed"
  | "resident_reported"

export type RentChargePaidResult = {
  paid: boolean
  runId: string | null
  billingPeriod: string | null
  source: RentChargePaidSource | null
  stripeCheckoutSessionId: string | null
}

export type MaintenanceInvoicePaidSource =
  | "stripe_checkout"
  | "admin_approved"

export type MaintenanceInvoicePaidResult = {
  paid: boolean
  invoiceId: string | null
  status: string | null
  source: MaintenanceInvoicePaidSource | null
  stripeCheckoutSessionId: string | null
}

type RentRunLike = Pick<
  WorkflowRunRow,
  "id" | "template_id" | "status" | "metadata"
>

type InvoiceRowLike = {
  id?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function readMetadata(run: { metadata?: unknown }): Record<string, unknown> {
  const meta = run.metadata
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? meta as Record<string, unknown>
  : {}
}

/** Pure check against an in-memory rent_collection run (no I/O). */
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
  if (!run || run.template_id !== "rent_collection") return empty

  const meta = readMetadata(run)
  const billingPeriod = runBillingPeriod(run as WorkflowRunRow) ??
    readString(meta.billing_period)
  const sessionId = readString(meta.stripe_checkout_session_id) ??
    readString(
      (meta.step_state as Record<string, unknown> | undefined)
        ?.stripe_checkout_session_id,
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

  const paymentIntent = readString(meta.payment_intent) ??
    readString(
      (meta.step_state as Record<string, unknown> | undefined)?.payment_intent,
    )
  const rentClassification = readString(meta.rent_classification)
  const adminMarked = readString(meta.admin_payment_received_at)
  const stripeCompleted = readString(meta.stripe_payment_completed_at)
  const completed = run.status === "completed"

  let source: RentChargePaidSource | null = null
  if (completed && stripeCompleted && sessionId) {
    source = "stripe_checkout"
  } else if (completed && adminMarked) {
    source = "admin_marked"
  } else if (
    completed &&
    (paymentIntent === "paid" || rentClassification === "paid")
  ) {
    source = stripeCompleted || sessionId
      ? "stripe_checkout"
      : adminMarked
      ? "admin_marked"
      : "resident_reported"
  } else if (
    completed &&
    rentClassification === "paid"
  ) {
    source = "workflow_completed"
  }

  const paid = source !== null

  return {
    paid,
    runId: run.id,
    billingPeriod,
    source,
    stripeCheckoutSessionId: sessionId,
  }
}

/** Load a rent_collection run and check whether that charge was paid. */
export async function isRentChargePaid(
  supabase: SupabaseClient,
  params: {
    runId: string
    landlordId?: string | null
    billingPeriod?: string | null
    stripeCheckoutSessionId?: string | null
  },
): Promise<RentChargePaidResult> {
  const runId = params.runId.trim()
  if (!runId) {
    return {
      paid: false,
      runId: null,
      billingPeriod: null,
      source: null,
      stripeCheckoutSessionId: null,
    }
  }

  let builder = supabase
    .from("workflow_runs")
    .select("id, template_id, status, metadata, landlord_id")
    .eq("id", runId)
    .eq("template_id", "rent_collection")

  const landlordId = params.landlordId?.trim()
  if (landlordId) {
    builder = builder.eq("landlord_id", landlordId)
  }

  const { data, error } = await builder.maybeSingle()
  if (error || !data) {
    return {
      paid: false,
      runId,
      billingPeriod: params.billingPeriod ?? null,
      source: null,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
    }
  }

  return isRentChargePaidFromRun(data as WorkflowRunRow, {
    billingPeriod: params.billingPeriod,
    stripeCheckoutSessionId: params.stripeCheckoutSessionId,
  })
}

/** Pure check against an in-memory maintenance_invoices row (no I/O). */
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

  if (status !== "approved") {
    return {
      paid: false,
      invoiceId: String(invoice.id),
      status,
      source: null,
      stripeCheckoutSessionId: sessionId,
    }
  }

  const source: MaintenanceInvoicePaidSource = sessionId ||
      readString(meta.stripe_payment_intent_id)
    ? "stripe_checkout"
    : "admin_approved"

  return {
    paid: true,
    invoiceId: String(invoice.id),
    status,
    source,
    stripeCheckoutSessionId: sessionId,
  }
}

/** Load a maintenance invoice and check whether it was paid / approved. */
export async function isMaintenanceInvoicePaid(
  supabase: SupabaseClient,
  params: {
    invoiceId: string
    landlordId?: string | null
    stripeCheckoutSessionId?: string | null
  },
): Promise<MaintenanceInvoicePaidResult> {
  const invoiceId = params.invoiceId.trim()
  if (!invoiceId) {
    return {
      paid: false,
      invoiceId: null,
      status: null,
      source: null,
      stripeCheckoutSessionId: null,
    }
  }

  let builder = supabase
    .from("maintenance_invoices")
    .select("id, status, metadata, landlord_id")
    .eq("id", invoiceId)

  const landlordId = params.landlordId?.trim()
  if (landlordId) {
    builder = builder.eq("landlord_id", landlordId)
  }

  const { data, error } = await builder.maybeSingle()
  if (error || !data) {
    return {
      paid: false,
      invoiceId,
      status: null,
      source: null,
      stripeCheckoutSessionId: params.stripeCheckoutSessionId ?? null,
    }
  }

  return isMaintenanceInvoicePaidFromRow(
    data as InvoiceRowLike,
    { stripeCheckoutSessionId: params.stripeCheckoutSessionId },
  )
}
