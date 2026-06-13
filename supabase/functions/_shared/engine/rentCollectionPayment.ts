import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { fetchWorkflowTemplateConfig } from "./templateConfig.ts"
import {
  logRentCollectionGraphEvent,
  RENT_GRAPH_EVENTS,
  type RentCollectionGraphScope,
} from "./rentCollectionGraph.ts"
import { logPipelineStageEvent, logWorkflowEvent } from "./workflowRuns.ts"

export type RentPaymentProvider = {
  provider: string
  paymentLink: string
}

export type RentCollectionActResult = {
  paymentLink: string | null
  paymentRequested: boolean
  provider: string | null
}

function withHttpsScheme(origin: string): string {
  const trimmed = origin.trim().replace(/\/$/, "")
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
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

  const url = new URL(`${baseUrl.replace(/\/$/, "")}/pay/rent`)
  url.searchParams.set("run", params.runId)
  url.searchParams.set("resident", params.residentId)
  url.searchParams.set("period", params.billingPeriod)
  url.searchParams.set("amount", String(params.amountDue))

  return { provider, paymentLink: url.toString() }
}

/** Resolve an online rent payment link when a provider is configured. */
export async function resolveRentPaymentLink(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    runId: string
    billingPeriod: string
    amountDue: number
  },
): Promise<RentPaymentProvider | null> {
  const envProvider = Deno.env.get("RENT_PAYMENT_PROVIDER")?.trim() ?? ""
  const envBase = Deno.env.get("RENT_PAYMENT_BASE_URL")?.trim() ??
    Deno.env.get("APP_URL")?.trim() ??
    ""

  if (envProvider && envBase) {
    const baseUrl = withHttpsScheme(envBase)
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/pay/rent`)
    url.searchParams.set("run", params.runId)
    url.searchParams.set("resident", params.residentId)
    url.searchParams.set("period", params.billingPeriod)
    url.searchParams.set("amount", String(params.amountDue))
    return { provider: envProvider, paymentLink: url.toString() }
  }

  const template = await fetchWorkflowTemplateConfig(supabase, "rent_collection")
  if (!template?.route_config) return null

  return paymentLinkFromTemplateConfig(template.route_config, params)
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

  await logWorkflowEvent(supabase, {
    workflowRunId: params.runId,
    eventType: "payment_requested",
    step: "payment_requested",
    stage: "act",
    message: "Rent payment requested (no payment provider configured)",
    landlordId: params.landlordId,
    workflowType: "rent_collection",
    metadata: {
      amount_due: params.amountDue,
      billing_period: params.billingPeriod,
      channels: params.routeChannels,
      sms_sent: params.smsSent,
      email_sent: params.emailSent,
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
      reason: "no_payment_provider",
    },
  })

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "act",
    step: "payment_requested",
    message: "Payment requested (no payment provider)",
    metadata: {
      amount_due: params.amountDue,
      billing_period: params.billingPeriod,
    },
  })

  return {
    paymentLink: null,
    paymentRequested: true,
    provider: null,
  }
}
