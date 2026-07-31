/**
 * Stripe Checkout for resident rent payments (destination charge to landlord Connect).
 * Used by rent_collection outreach and the rent-payment-checkout Edge Function.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  applicationFeeCents,
  isLandlordStripeConnectReady,
  isStripeConfigured,
  isStripeConnectReady,
  loadLandlordStripeDestination,
  stripeForm,
  stripeGet,
  type StripeConnectDestination,
} from "../stripeConnect.ts"
import {
  logRentCollectionGraphEvent,
  logRentCollectionLedgerWithGraph,
  rentCollectionGraphScopeFromRun,
  RENT_GRAPH_EVENTS,
} from "./rentCollectionGraph.ts"
import { logPipelineStageEvent, logWorkflowEvent } from "./workflowRuns.ts"
import { uloAppOrigin } from "../uloAppUrl.ts"

/** @deprecated Prefer StripeConnectDestination from stripeConnect.ts */
export type LandlordRentDestination = StripeConnectDestination

/** Load landlord Connect destination for rent Checkout (shared helper). */
export async function loadLandlordRentDestination(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<StripeConnectDestination | null> {
  return loadLandlordStripeDestination(supabase, landlordId)
}

/** Landlord Connect ready for rent Checkout (shared readiness rule). */
export async function isLandlordRentPayoutsReady(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<boolean> {
  return isLandlordStripeConnectReady(supabase, landlordId)
}

export type RentCheckoutCreateResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; error: string }

export type RentCheckoutCompleteResult =
  | {
    ok: true
    runId: string
    residentId: string | null
    landlordId: string
    amountPaid: number
    alreadyCompleted?: boolean
  }
  | { ok: false; error: string; status?: number }

export function isRentStripeConfigured(): boolean {
  return isStripeConfigured()
}

export function rentPaymentAppOrigin(): string {
  return uloAppOrigin({ preferRentBase: true, fallback: "" })
}

function stripeErrorMessage(json: Record<string, unknown>): string {
  const err = json.error as { message?: string } | undefined
  return err?.message?.trim() || "Stripe request failed"
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Create a Stripe Checkout Session for a rent_collection run (destination → landlord). */
export async function createRentCheckoutSession(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    residentId: string
    billingPeriod: string
    amountDue: number
    residentName?: string | null
    unitLabel?: string | null
  },
): Promise<RentCheckoutCreateResult> {
  if (!isRentStripeConfigured()) {
    return { ok: false, error: "Stripe is not configured for rent payments." }
  }

  const destination = await loadLandlordRentDestination(
    supabase,
    params.landlordId,
  )
  if (!isStripeConnectReady(destination)) {
    return {
      ok: false,
      error:
        "Your property manager hasn't finished payout setup yet. Rent can't be paid online right now.",
    }
  }

  const amountCents = Math.round(Number(params.amountDue) * 100)
  if (!Number.isFinite(amountCents) || amountCents < 50) {
    return { ok: false, error: "Rent amount is too small to charge." }
  }

  const origin = rentPaymentAppOrigin()
  if (!origin) {
    return {
      ok: false,
      error: "APP_URL or RENT_PAYMENT_BASE_URL must be set for rent Checkout return URLs.",
    }
  }

  // Stripe substitutes {CHECKOUT_SESSION_ID} literally — do not URL-encode braces.
  const successUrl =
    `${origin}/pay/rent?rent_payment=success` +
    `&session_id={CHECKOUT_SESSION_ID}` +
    `&run=${encodeURIComponent(params.runId)}`
  const cancelUrl =
    `${origin}/pay/rent?rent_payment=cancel` +
    `&run=${encodeURIComponent(params.runId)}` +
    `&resident=${encodeURIComponent(params.residentId)}`

  const unitBit = params.unitLabel?.trim()
    ? ` · Unit ${params.unitLabel.trim()}`
    : ""
  const nameBit = params.residentName?.trim()
    ? ` for ${params.residentName.trim()}`
    : ""

  const body = new URLSearchParams()
  body.set("mode", "payment")
  body.set("success_url", successUrl)
  body.set("cancel_url", cancelUrl)
  body.set("client_reference_id", params.runId)
  body.set("billing_address_collection", "auto")
  body.set("payment_method_types[0]", "card")
  body.set("payment_method_types[1]", "us_bank_account")
  body.set(
    "payment_method_options[us_bank_account][financial_connections][permissions][0]",
    "payment_method",
  )
  body.set(
    "payment_method_options[us_bank_account][financial_connections][permissions][1]",
    "balances",
  )
  body.set("line_items[0][price_data][currency]", "usd")
  body.set("line_items[0][price_data][unit_amount]", String(amountCents))
  body.set(
    "line_items[0][price_data][product_data][name]",
    `Rent — ${params.billingPeriod}${unitBit}`,
  )
  body.set(
    "line_items[0][price_data][product_data][description]",
    `Rent payment${nameBit} for ${params.billingPeriod}`,
  )
  body.set("line_items[0][quantity]", "1")
  body.set("metadata[workflow_run_id]", params.runId)
  body.set("metadata[landlord_id]", params.landlordId)
  body.set("metadata[resident_id]", params.residentId)
  body.set("metadata[billing_period]", params.billingPeriod)
  body.set("metadata[payment_kind]", "rent_collection")
  body.set("metadata[stripe_connect_account_id]", destination.accountId)
  body.set(
    "payment_intent_data[transfer_data][destination]",
    destination.accountId,
  )
  const feeCents = applicationFeeCents(amountCents)
  if (feeCents > 0) {
    body.set(
      "payment_intent_data[application_fee_amount]",
      String(feeCents),
    )
  }
  body.set(
    "payment_intent_data[metadata][workflow_run_id]",
    params.runId,
  )
  body.set(
    "payment_intent_data[metadata][landlord_id]",
    params.landlordId,
  )
  body.set(
    "payment_intent_data[metadata][resident_id]",
    params.residentId,
  )
  body.set(
    "payment_intent_data[metadata][payment_kind]",
    "rent_collection",
  )
  body.set(
    "payment_intent_data[metadata][stripe_connect_account_id]",
    destination.accountId,
  )

  const created = await stripeForm("checkout/sessions", body)
  if (!created.ok) {
    return { ok: false, error: stripeErrorMessage(created.json) }
  }

  const url = typeof created.json.url === "string" ? created.json.url.trim() : ""
  const sessionId =
    typeof created.json.id === "string" ? created.json.id.trim() : ""
  if (!url || !sessionId) {
    return { ok: false, error: "Stripe did not return a checkout URL." }
  }

  return { ok: true, url, sessionId }
}

/** Persist Checkout session id on the workflow run (best-effort). */
export async function stampRentCheckoutOnRun(
  supabase: SupabaseClient,
  params: {
    runId: string
    sessionId: string
    paymentLink: string
  },
): Promise<void> {
  const { data: run } = await supabase
    .from("workflow_runs")
    .select("metadata")
    .eq("id", params.runId)
    .maybeSingle()

  const metadata =
    run?.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
      ? { ...(run.metadata as Record<string, unknown>) }
      : {}
  const stepState =
    metadata.step_state &&
      typeof metadata.step_state === "object" &&
      !Array.isArray(metadata.step_state)
      ? { ...(metadata.step_state as Record<string, unknown>) }
      : {}

  await supabase
    .from("workflow_runs")
    .update({
      metadata: {
        ...metadata,
        payment_link: params.paymentLink,
        payment_provider: "stripe",
        stripe_checkout_session_id: params.sessionId,
        step_state: {
          ...stepState,
          payment_link: params.paymentLink,
          payment_provider: "stripe",
          stripe_checkout_session_id: params.sessionId,
        },
      },
    })
    .eq("id", params.runId)
}

/**
 * Verify a paid Checkout session and close the rent_collection run.
 * Idempotent when the run is already completed.
 */
export async function completeRentCheckoutFromSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<RentCheckoutCompleteResult> {
  if (!sessionId.startsWith("cs_")) {
    return { ok: false, error: "Invalid checkout session id.", status: 400 }
  }

  const retrieved = await stripeGet(
    `checkout/sessions/${encodeURIComponent(sessionId)}` +
      `?expand[]=payment_intent`,
  )
  if (!retrieved.ok) {
    return {
      ok: false,
      error: stripeErrorMessage(retrieved.json),
      status: 502,
    }
  }

  const session = retrieved.json
  const paymentStatus =
    typeof session.payment_status === "string" ? session.payment_status : ""
  const status = typeof session.status === "string" ? session.status : ""

  // ACH can be processing while unpaid — accept paid or processing with a PI.
  const pi = asRecord(session.payment_intent)
  const piStatus = typeof pi?.status === "string" ? pi.status : ""
  const accepted =
    paymentStatus === "paid" ||
    (paymentStatus === "unpaid" &&
      (piStatus === "processing" || piStatus === "succeeded")) ||
    (status === "complete" && paymentStatus === "paid")

  if (!accepted && paymentStatus !== "paid") {
    return {
      ok: false,
      error: "Payment is not complete yet. If you paid by bank transfer, it may still be processing.",
      status: 409,
    }
  }

  const meta = asRecord(session.metadata) ?? {}
  const runId =
    typeof meta.workflow_run_id === "string" ? meta.workflow_run_id.trim() : ""
  const landlordId =
    typeof meta.landlord_id === "string" ? meta.landlord_id.trim() : ""
  const residentId =
    typeof meta.resident_id === "string" ? meta.resident_id.trim() : ""

  if (!runId || !landlordId) {
    return {
      ok: false,
      error: "Checkout session is missing rent payment metadata.",
      status: 400,
    }
  }

  const amountTotal =
    typeof session.amount_total === "number" ? session.amount_total : 0
  const amountPaid = amountTotal / 100

  const { data: run, error: runErr } = await supabase
    .from("workflow_runs")
    .select("id, status, landlord_id, resident_id, metadata, unit_id, property_id")
    .eq("id", runId)
    .eq("landlord_id", landlordId)
    .eq("template_id", "rent_collection")
    .maybeSingle()

  if (runErr || !run) {
    return { ok: false, error: "Rent collection run not found.", status: 404 }
  }

  if (run.status === "completed") {
    return {
      ok: true,
      runId,
      residentId: run.resident_id ? String(run.resident_id) : residentId || null,
      landlordId,
      amountPaid,
      alreadyCompleted: true,
    }
  }

  const now = new Date().toISOString()
  const metadata =
    run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
      ? { ...(run.metadata as Record<string, unknown>) }
      : {}
  const stepState =
    metadata.step_state &&
      typeof metadata.step_state === "object" &&
      !Array.isArray(metadata.step_state)
      ? { ...(metadata.step_state as Record<string, unknown>) }
      : {}

  const resolvedResidentId = run.resident_id
    ? String(run.resident_id)
    : residentId || null

  if (resolvedResidentId) {
    const { error: balErr } = await supabase
      .from("users")
      .update({ balance_due: 0 })
      .eq("id", resolvedResidentId)
      .eq("landlord_id", landlordId)
    if (balErr) {
      console.error("[rent-stripe] balance clear", balErr)
      return { ok: false, error: balErr.message, status: 500 }
    }
  }

  const { error: updErr } = await supabase
    .from("workflow_runs")
    .update({
      status: "completed",
      current_step: "completed",
      current_stage: "completed",
      completed_at: now,
      metadata: {
        ...metadata,
        amount_due: 0,
        payment_intent: "paid",
        rent_classification: "paid",
        stripe_checkout_session_id: sessionId,
        stripe_payment_completed_at: now,
        escalated_at: null,
        escalation_reason: null,
        step_state: {
          ...stepState,
          step: "completed",
          amount_due: 0,
          payment_intent: "paid",
          rent_classification: "paid",
          stripe_checkout_session_id: sessionId,
        },
      },
    })
    .eq("id", runId)
    .eq("landlord_id", landlordId)

  if (updErr) {
    return { ok: false, error: updErr.message, status: 500 }
  }

  // Also close any other open rent_collection runs for this resident.
  if (resolvedResidentId) {
    const { data: openRuns } = await supabase
      .from("workflow_runs")
      .select("id, metadata")
      .eq("landlord_id", landlordId)
      .eq("resident_id", resolvedResidentId)
      .eq("template_id", "rent_collection")
      .in("status", ["active", "escalated"])
      .neq("id", runId)

    for (const other of openRuns ?? []) {
      const otherMeta =
        other.metadata && typeof other.metadata === "object" &&
          !Array.isArray(other.metadata)
          ? { ...(other.metadata as Record<string, unknown>) }
          : {}
      const otherStep =
        otherMeta.step_state &&
          typeof otherMeta.step_state === "object" &&
          !Array.isArray(otherMeta.step_state)
          ? { ...(otherMeta.step_state as Record<string, unknown>) }
          : {}
      await supabase
        .from("workflow_runs")
        .update({
          status: "completed",
          current_step: "completed",
          current_stage: "completed",
          completed_at: now,
          metadata: {
            ...otherMeta,
            amount_due: 0,
            payment_intent: "paid",
            rent_classification: "paid",
            stripe_payment_completed_at: now,
            completed_via_sibling_checkout: runId,
            step_state: {
              ...otherStep,
              step: "completed",
              amount_due: 0,
              payment_intent: "paid",
              rent_classification: "paid",
            },
          },
        })
        .eq("id", other.id)
    }
  }

  const scope = rentCollectionGraphScopeFromRun(
    {
      id: runId,
      landlord_id: landlordId,
      resident_id: resolvedResidentId,
      unit_id: run.unit_id ? String(run.unit_id) : null,
      property_id: run.property_id ? String(run.property_id) : null,
      metadata,
    },
    landlordId,
  )

  const billingPeriod =
    typeof metadata.billing_period === "string"
      ? metadata.billing_period
      : typeof meta.billing_period === "string"
      ? meta.billing_period
      : null

  await logRentCollectionLedgerWithGraph(supabase, scope, {
    ledgerEventType: "rent_payment_stripe",
    direction: "credit",
    amount: amountPaid > 0 ? amountPaid : null,
    billingPeriod,
    description: "Rent paid via Stripe Checkout",
    metadata: {
      stripe_checkout_session_id: sessionId,
      source: "stripe_checkout",
      payment_status: paymentStatus,
    },
  })

  await logRentCollectionGraphEvent(supabase, scope, {
    eventType: RENT_GRAPH_EVENTS.paymentReceived,
    source: "automation",
    actorType: "resident",
    metadata: {
      message: "Resident paid rent via Stripe Checkout.",
      stripe_checkout_session_id: sessionId,
      amount_paid: amountPaid,
      billing_period: billingPeriod,
      source: "stripe_checkout",
    },
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: runId,
    eventType: "payment_received",
    step: "payment_received",
    stage: "act",
    message: "Rent paid via Stripe Checkout",
    landlordId,
    workflowType: "rent_collection",
    metadata: {
      stripe_checkout_session_id: sessionId,
      amount_paid: amountPaid,
      source: "stripe_checkout",
    },
  })

  await logPipelineStageEvent(supabase, {
    runId,
    stage: "act",
    step: "payment_received",
    message: "Stripe Checkout payment completed",
    metadata: {
      stripe_checkout_session_id: sessionId,
      amount_paid: amountPaid,
    },
  })

  return {
    ok: true,
    runId,
    residentId: resolvedResidentId,
    landlordId,
    amountPaid,
  }
}
