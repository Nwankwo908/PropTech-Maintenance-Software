import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { fetchWorkflowTemplateConfig } from "./templateConfig.ts"
import {
  logRentCollectionGraphEvent,
  RENT_GRAPH_EVENTS,
  type RentCollectionGraphScope,
} from "./rentCollectionGraph.ts"
import { logPipelineStageEvent, logWorkflowEvent } from "./workflowRuns.ts"
import {
  createRentCheckoutSession,
  isLandlordRentPayoutsReady,
  isRentStripeConfigured,
  rentPaymentAppOrigin,
  stampRentCheckoutOnRun,
} from "./rentStripeCheckout.ts"
import { normalizeAppOrigin, uloAppUrl } from "../uloAppUrl.ts"

export type RentPaymentProvider = {
  provider: string
  paymentLink: string
  sessionId?: string
}

export type RentCollectionActResult = {
  paymentLink: string | null
  paymentRequested: boolean
  provider: string | null
}

function withHttpsScheme(origin: string): string {
  return normalizeAppOrigin(origin)
}

function durablePayRentUrl(params: {
  origin: string
  runId: string
  residentId: string
  billingPeriod: string
  amountDue: number
}): string {
  return uloAppUrl.rentPayment(
    {
      runId: params.runId,
      residentId: params.residentId,
      billingPeriod: params.billingPeriod,
      amountDue: params.amountDue,
    },
    { returnOrigin: params.origin, preferRentBase: true },
  )
}

function paymentLinkFromTemplateConfig(
  routeConfig: Record<string, unknown>,
  params: {
    runId: string
    residentId: string
    billingPeriod: string
    amountDue: number
  },
): RentPaymentProvider | null {
  const act = routeConfig.act
  if (!act || typeof act !== "object") return null

  const actConfig = act as Record<string, unknown>
  const provider = typeof actConfig.payment_provider === "string"
    ? actConfig.payment_provider.trim()
    : ""
  const baseUrl = typeof actConfig.payment_base_url === "string"
    ? withHttpsScheme(actConfig.payment_base_url)
    : ""

  if (!provider || !baseUrl) return null

  return {
    provider,
    paymentLink: durablePayRentUrl({
      origin: baseUrl,
      runId: params.runId,
      residentId: params.residentId,
      billingPeriod: params.billingPeriod,
      amountDue: params.amountDue,
    }),
  }
}

function rentPaymentProviderEnabled(): boolean {
  const raw = Deno.env.get("RENT_PAYMENT_PROVIDER")?.trim().toLowerCase() ?? ""
  if (raw === "off" || raw === "none" || raw === "false" || raw === "0") {
    return false
  }
  if (raw === "stripe" || raw === "") return true
  return Boolean(raw)
}

/** Resolve an online rent payment link when landlord payouts are ready. */
export async function resolveRentPaymentLink(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    runId: string
    billingPeriod: string
    amountDue: number
    residentName?: string | null
    unitLabel?: string | null
  },
): Promise<RentPaymentProvider | null> {
  if (!rentPaymentProviderEnabled()) {
    return null
  }

  // Do not embed a pay link until the landlord can receive destination charges.
  const payoutsReady = await isLandlordRentPayoutsReady(
    supabase,
    params.landlordId,
  )
  if (!payoutsReady) {
    return null
  }

  const origin = rentPaymentAppOrigin()
  const durable = origin
    ? durablePayRentUrl({
      origin,
      runId: params.runId,
      residentId: params.residentId,
      billingPeriod: params.billingPeriod,
      amountDue: params.amountDue,
    })
    : null

  if (isRentStripeConfigured()) {
    const created = await createRentCheckoutSession(supabase, {
      landlordId: params.landlordId,
      runId: params.runId,
      residentId: params.residentId,
      billingPeriod: params.billingPeriod,
      amountDue: params.amountDue,
      residentName: params.residentName,
      unitLabel: params.unitLabel,
    })
    if (created.ok) {
      await stampRentCheckoutOnRun(supabase, {
        runId: params.runId,
        sessionId: created.sessionId,
        paymentLink: created.url,
      })
      return {
        provider: "stripe",
        paymentLink: created.url,
        sessionId: created.sessionId,
      }
    }
    console.error(
      "[rent-collection] Stripe Checkout create failed; falling back to /pay/rent",
      created.error,
    )
    if (durable) {
      return { provider: "stripe", paymentLink: durable }
    }
  }

  const envProvider = Deno.env.get("RENT_PAYMENT_PROVIDER")?.trim() ?? ""
  if (envProvider && durable) {
    return { provider: envProvider, paymentLink: durable }
  }

  const template = await fetchWorkflowTemplateConfig(supabase, "rent_collection")
  if (!template?.route_config) {
    return durable ? { provider: "stripe", paymentLink: durable } : null
  }

  return paymentLinkFromTemplateConfig(template.route_config, params) ??
    (durable ? { provider: "stripe", paymentLink: durable } : null)
}

/**
 * Act: include payment link metadata when a provider exists;
 * otherwise log payment_requested only.
 */
export async function actRentCollectionPaymentRequest(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    residentId: string
    billingPeriod: string
    amountDue: number
    paymentProvider: RentPaymentProvider | null
    routeChannels: string[]
    smsSent: boolean
    emailSent: boolean
    graphScope: RentCollectionGraphScope
  },
): Promise<RentCollectionActResult> {
  const paymentLink = params.paymentProvider?.paymentLink ?? null
  const provider = params.paymentProvider?.provider ?? null

  if (paymentLink) {
    await logWorkflowEvent(supabase, {
      workflowRunId: params.runId,
      eventType: "payment_link_included",
      step: "payment_link_included",
      stage: "act",
      message: "Payment link included in rent collection outreach",
      landlordId: params.landlordId,
      workflowType: "rent_collection",
      metadata: {
        payment_link: paymentLink,
        payment_provider: provider,
        stripe_checkout_session_id: params.paymentProvider?.sessionId ?? null,
        channels: params.routeChannels,
        sms_sent: params.smsSent,
        email_sent: params.emailSent,
        amount_due: params.amountDue,
        billing_period: params.billingPeriod,
      },
    })

    await logPipelineStageEvent(supabase, {
      runId: params.runId,
      stage: "act",
      step: "payment_link_included",
      message: "Payment link included in outreach",
      metadata: {
        payment_provider: provider,
        payment_link: paymentLink,
        channels: params.routeChannels,
      },
    })

    return {
      paymentLink,
      paymentRequested: false,
      provider,
    }
  }

  const payoutsReady = await isLandlordRentPayoutsReady(
    supabase,
    params.landlordId,
  )
  const reason = payoutsReady
    ? "no_payment_provider"
    : "landlord_payouts_not_ready"

  await logWorkflowEvent(supabase, {
    workflowRunId: params.runId,
    eventType: "payment_requested",
    step: "payment_requested",
    stage: "act",
    message: payoutsReady
      ? "Rent payment requested (no payment provider configured)"
      : "Rent payment requested (landlord payouts not ready)",
    landlordId: params.landlordId,
    workflowType: "rent_collection",
    metadata: {
      amount_due: params.amountDue,
      billing_period: params.billingPeriod,
      channels: params.routeChannels,
      sms_sent: params.smsSent,
      email_sent: params.emailSent,
      reason,
    },
  })

  await logRentCollectionGraphEvent(supabase, params.graphScope, {
    eventType: RENT_GRAPH_EVENTS.paymentRequested,
    metadata: {
      amount_due: params.amountDue,
      billing_period: params.billingPeriod,
      channels: params.routeChannels,
      sms_sent: params.smsSent,
      email_sent: params.emailSent,
      reason,
    },
  })

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "act",
    step: "payment_requested",
    message: payoutsReady
      ? "Payment requested (no payment provider)"
      : "Payment requested (landlord payouts not ready)",
    metadata: {
      amount_due: params.amountDue,
      billing_period: params.billingPeriod,
      reason,
    },
  })

  return {
    paymentLink: null,
    paymentRequested: true,
    provider: null,
  }
}
