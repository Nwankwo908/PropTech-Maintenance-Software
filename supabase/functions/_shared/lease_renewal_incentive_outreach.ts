import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { sendInboundAutoReply } from "./sms/inboundReply.ts"
import {
  findOrCreateConversation,
  findResidentConversationByPhone,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "./sms/landlordSmsOnboarding.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  updateWorkflowRun,
} from "./engine/workflowRuns.ts"
import { isNonDeliverableDemoPhone } from "./late_rent_account_outreach.ts"

export type SendLeaseRenewalIncentiveSmsResult = {
  ok: boolean
  conversationId: string | null
  messageId: string | null
  error?: string
  deliverySimulated?: boolean
}

function isInvalidDestinationError(error: string | undefined): boolean {
  if (!error) return false
  return /10002|Invalid (destination )?number|Invalid phone number/i.test(error)
}

async function insertSimulatedOutboundMessage(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    fromNumber: string
    toNumber: string
    body: string
    provider: string
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("sms_messages")
    .insert({
      conversation_id: params.conversationId,
      landlord_id: params.landlordId,
      direction: "outbound",
      from_number: normalizeSmsPhone(params.fromNumber),
      to_number: normalizeSmsPhone(params.toNumber),
      body: params.body,
      media_urls: [],
      provider: params.provider,
      provider_message_sid: `demo-${crypto.randomUUID()}`,
      provider_status: "sent",
      raw_payload: {
        source: "dashboard_lease_renewal_incentive",
        delivery: "simulated",
        reason: "demo_placeholder_phone_skipped_telnyx",
      },
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error(
      "[lease-renewal-incentive-outreach] simulated message save failed",
      error?.message,
    )
    return null
  }
  return data.id as string
}

/**
 * Send a landlord-composed lease renewal incentive SMS into the resident
 * conversation so it appears in Communication inbox + monitoring.
 */
export async function sendLeaseRenewalIncentiveSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    workflowRunId: string
    residentId: string
    residentPhone: string
    message: string
    incentiveAmountLabel?: string | null
  },
): Promise<SendLeaseRenewalIncentiveSmsResult> {
  const body = params.message.trim()
  if (!body) {
    return { ok: false, conversationId: null, messageId: null, error: "Message is empty." }
  }

  const run = await getWorkflowRunById(supabase, params.workflowRunId)
  if (!run) {
    return { ok: false, conversationId: null, messageId: null, error: "Workflow run not found." }
  }
  if (run.landlord_id !== params.landlordId) {
    return { ok: false, conversationId: null, messageId: null, error: "Workflow run landlord mismatch." }
  }
  if (run.template_id !== "lease_renewal") {
    return {
      ok: false,
      conversationId: null,
      messageId: null,
      error: "Workflow run is not a lease renewal run.",
    }
  }

  const mainLine = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!mainLine) {
    return {
      ok: false,
      conversationId: null,
      messageId: null,
      error: "No active landlord SMS number",
    }
  }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone: params.residentPhone,
    landlordId: params.landlordId,
    identityType: "resident",
    residentId: params.residentId,
  })
  if (!identity) {
    return {
      ok: false,
      conversationId: null,
      messageId: null,
      error: "Could not resolve resident SMS identity",
    }
  }

  const existing = await findResidentConversationByPhone(supabase, {
    landlordId: params.landlordId,
    smsNumberId: mainLine.id,
    externalPhone: params.residentPhone,
    residentId: params.residentId,
  })

  let conversationId: string
  if (existing) {
    conversationId = existing.id
    const nextType =
      existing.conversation_type === "ai_copilot" ||
        existing.conversation_type === "landlord_update"
        ? "resident_intake"
        : existing.conversation_type
    const { error: reopenError } = await supabase
      .from("sms_conversations")
      .update({
        updated_at: new Date().toISOString(),
        status: "open",
        conversation_type: nextType,
        resident_id: params.residentId,
        external_phone_number: normalizeSmsPhone(params.residentPhone),
      })
      .eq("id", existing.id)
    if (reopenError) {
      return {
        ok: false,
        conversationId: existing.id,
        messageId: null,
        error: "Could not update resident conversation",
      }
    }
  } else {
    const created = await findOrCreateConversation(supabase, {
      landlordId: params.landlordId,
      smsNumberId: mainLine.id,
      externalPhone: params.residentPhone,
      identity,
      maintenanceRequestId: null,
      conversationStatus: "open",
    })
    conversationId = created.conversationId
  }

  await linkConversationToWorkflowRun(supabase, {
    conversationId,
    runId: params.workflowRunId,
    templateId: "lease_renewal",
  })

  const demoPhone = isNonDeliverableDemoPhone(params.residentPhone)
  let messageId: string | null = null
  let deliverySimulated = false

  if (demoPhone) {
    messageId = await insertSimulatedOutboundMessage(supabase, {
      conversationId,
      landlordId: params.landlordId,
      fromNumber: mainLine.phone,
      toNumber: params.residentPhone,
      body,
      provider: mainLine.provider,
    })
    if (!messageId) {
      return {
        ok: false,
        conversationId,
        messageId: null,
        error: "Could not log incentive message to the conversation inbox.",
      }
    }
    deliverySimulated = true
  } else {
    const sent = await sendInboundAutoReply(supabase, {
      conversationId,
      landlordId: params.landlordId,
      fromNumber: mainLine.phone,
      toNumber: params.residentPhone,
      body,
      provider: mainLine.provider,
      source: "dashboard_lease_renewal_incentive",
    })

    if (!sent.ok) {
      if (sent.messageId && isInvalidDestinationError(sent.error)) {
        messageId = sent.messageId
        deliverySimulated = true
      } else {
        return {
          ok: false,
          conversationId,
          messageId: sent.messageId ?? null,
          error: sent.error ?? "Failed to send SMS",
        }
      }
    } else {
      messageId = sent.messageId
    }
  }

  const now = new Date().toISOString()
  await updateWorkflowRun(supabase, params.workflowRunId, {
    metadata: {
      conversation_id: conversationId,
      renewal_incentive_sms_sent: true,
      renewal_incentive_sms_sent_at: now,
      ...(params.incentiveAmountLabel
        ? { renewal_incentive_amount_label: params.incentiveAmountLabel }
        : {}),
      ...(deliverySimulated ? { renewal_incentive_sms_delivery: "simulated" } : {}),
    },
    eventMessage: deliverySimulated
      ? "Renewal incentive logged to resident SMS thread (demo delivery)"
      : "Renewal incentive SMS sent to resident",
    eventStep: "offer_renewal_incentive",
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "lease.renewal_incentive_sms_sent",
    source: "dashboard",
    actor_type: "landlord",
    resident_id: params.residentId,
    unit_id: run.unit_id,
    property_id: run.property_id,
    conversation_id: conversationId,
    message_id: messageId,
    workflow_run_id: params.workflowRunId,
    workflow_template_id: "lease_renewal",
    metadata: {
      message: body,
      channel: "sms",
      delivery: deliverySimulated ? "simulated" : "live",
      incentive_amount_label: params.incentiveAmountLabel ?? null,
    },
  })

  return {
    ok: true,
    conversationId,
    messageId,
    deliverySimulated,
  }
}
