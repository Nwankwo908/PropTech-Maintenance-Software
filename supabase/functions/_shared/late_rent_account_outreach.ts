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
  runAmountDue,
  runStepState,
  updateWorkflowRun,
} from "./engine/workflowRuns.ts"

export type LateRentAccountMessageAction = "offer_payment_plan" | "waive_late_fee"

/** Default late fee when the client does not pass an amount ($90). */
export const DEFAULT_LATE_FEE_DOLLARS = 90

export type SendLateRentAccountSmsResult = {
  ok: boolean
  conversationId: string | null
  messageId: string | null
  error?: string
  /** True when the inbox row was written but Telnyx was skipped/failed (demo numbers). */
  deliverySimulated?: boolean
  /** Present after a successful waive_late_fee balance adjustment. */
  balanceDueAfterWaiver?: number | null
  lateFeeWaived?: number | null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function resolveLateFeeDollars(lateFeeCents: number | null | undefined): number {
  if (lateFeeCents != null && Number.isFinite(lateFeeCents) && lateFeeCents > 0) {
    return Math.round(lateFeeCents) / 100
  }
  return DEFAULT_LATE_FEE_DOLLARS
}

function roundMoney(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100)
}

/**
 * After waive-late-fee SMS: subtract the late fee from the tenant's balance_due
 * and every open rent_collection run amount for that resident.
 */
export async function applyLateFeeWaiverBalances(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    workflowRunId: string
    lateFeeDollars: number
  },
): Promise<{
  ok: boolean
  previousBalance: number | null
  newBalance: number | null
  lateFeeWaived: number
  runsAdjusted: number
  error?: string
}> {
  const lateFee = Math.max(0, params.lateFeeDollars)
  if (lateFee <= 0) {
    return {
      ok: false,
      previousBalance: null,
      newBalance: null,
      lateFeeWaived: 0,
      runsAdjusted: 0,
      error: "Late fee amount must be positive.",
    }
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("id, balance_due")
    .eq("id", params.residentId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (userError || !userRow?.id) {
    return {
      ok: false,
      previousBalance: null,
      newBalance: null,
      lateFeeWaived: lateFee,
      runsAdjusted: 0,
      error: userError?.message ?? "Resident not found.",
    }
  }

  const previousBalance = asFiniteNumber(userRow.balance_due) ?? 0
  const newBalance = roundMoney(previousBalance - lateFee)

  const { error: balanceError } = await supabase
    .from("users")
    .update({ balance_due: newBalance })
    .eq("id", params.residentId)
    .eq("landlord_id", params.landlordId)

  if (balanceError) {
    return {
      ok: false,
      previousBalance,
      newBalance: null,
      lateFeeWaived: lateFee,
      runsAdjusted: 0,
      error: balanceError.message,
    }
  }

  const { data: rentRuns, error: runsError } = await supabase
    .from("workflow_runs")
    .select("id, metadata, status")
    .eq("landlord_id", params.landlordId)
    .eq("resident_id", params.residentId)
    .eq("template_id", "rent_collection")
    .in("status", ["active", "escalated"])

  if (runsError) {
    console.error("[late-rent-account-outreach] rent runs lookup", runsError.message)
  }

  const runIds = new Set<string>()
  for (const row of rentRuns ?? []) {
    if (typeof row.id === "string" && row.id) runIds.add(row.id)
  }
  runIds.add(params.workflowRunId)

  let runsAdjusted = 0
  for (const runId of runIds) {
    const run = await getWorkflowRunById(supabase, runId)
    if (!run) continue
    const metadata = (run.metadata ?? {}) as Record<string, unknown>
    // Idempotent: skip runs that already recorded this waiver.
    if (metadata.late_fee_waived === true) continue

    const step = runStepState<{ amount_due?: number }>(run)
    const currentAmount =
      runAmountDue(run) ?? asFiniteNumber(step.amount_due) ?? previousBalance
    const nextAmount = roundMoney(currentAmount - lateFee)

    const updated = await updateWorkflowRun(supabase, runId, {
      metadata: {
        amount_due: nextAmount,
        step_state: { ...step, amount_due: nextAmount },
        late_fee_waived: true,
        late_fee_waived_amount: lateFee,
        balance_due_before_waiver: currentAmount,
        balance_due_after_waiver: nextAmount,
      },
      eventMessage: runId === params.workflowRunId
        ? `Late fee of $${lateFee.toFixed(2)} waived — balance updated`
        : `Late fee waiver applied — balance adjusted to $${nextAmount.toFixed(2)}`,
      eventStep: "waive_late_fee",
    })
    if (updated) runsAdjusted += 1
  }

  return {
    ok: true,
    previousBalance,
    newBalance,
    lateFeeWaived: lateFee,
    runsAdjusted,
  }
}

/**
 * Seed/demo residents use NANP 555 exchange numbers (e.g. +15555620002).
 * Telnyx rejects those as invalid destinations (error 10002).
 */
export function isNonDeliverableDemoPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 10) return false
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (national.length !== 10) return false
  return national.slice(3, 6) === "555"
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
    source: string
    reason: string
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
        source: params.source,
        delivery: "simulated",
        reason: params.reason,
      },
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[late-rent-account-outreach] simulated message save failed", error?.message)
    return null
  }
  return data.id as string
}

/**
 * Send a landlord-composed late-rent SMS (payment plan / waive late fee) into the
 * resident_inbox conversation so it appears in Communication inbox + monitoring.
 */
export async function sendLateRentAccountSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    workflowRunId: string
    residentId: string
    residentPhone: string
    message: string
    action: LateRentAccountMessageAction
    installments?: number | null
    /** Late fee in cents — used when action is waive_late_fee. */
    lateFeeCents?: number | null
  },
): Promise<SendLateRentAccountSmsResult> {
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
  if (run.template_id !== "rent_collection") {
    return {
      ok: false,
      conversationId: null,
      messageId: null,
      error: "Workflow run is not a rent collection run.",
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

  // Prefer the existing resident SMS thread (e.g. late-rent reminder) so the
  // payment-plan offer appends as the latest Ulo AI message — not a new thread.
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
        // Keep the thread addressable by the resident's phone for future SMS.
        external_phone_number: normalizeSmsPhone(params.residentPhone),
      })
      .eq("id", existing.id)
    if (reopenError) {
      console.error(
        "[late-rent-account-outreach] conversation reopen failed",
        reopenError.message,
      )
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
    templateId: "rent_collection",
  })

  const source =
    params.action === "offer_payment_plan"
      ? "dashboard_rent_payment_plan"
      : "dashboard_rent_late_fee_waiver"

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
      source,
      reason: "demo_placeholder_phone_skipped_telnyx",
    })
    if (!messageId) {
      return {
        ok: false,
        conversationId,
        messageId: null,
        error: "Could not log payment plan message to the conversation inbox.",
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
      source,
    })

    if (!sent.ok) {
      // Message may still be in the inbox as failed; for invalid destinations keep UX moving
      // only when we persisted a row (demo-like / bad seed numbers that slipped past the check).
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
  const eventType =
    params.action === "offer_payment_plan"
      ? "rent.payment_plan_sms_sent"
      : "rent.late_fee_waiver_sms_sent"

  let balanceDueAfterWaiver: number | null = null
  let lateFeeWaived: number | null = null

  // Rule: once the landlord sends a late-fee waiver SMS, adjust all rent
  // balances associated with the tenant (users.balance_due + open rent runs).
  if (params.action === "waive_late_fee") {
    const alreadyWaived = (run.metadata as Record<string, unknown> | null)?.late_fee_waived ===
      true
    if (alreadyWaived) {
      lateFeeWaived = asFiniteNumber(
        (run.metadata as Record<string, unknown>).late_fee_waived_amount,
      )
      balanceDueAfterWaiver = asFiniteNumber(
        (run.metadata as Record<string, unknown>).balance_due_after_waiver,
      )
    } else {
      const waiver = await applyLateFeeWaiverBalances(supabase, {
        landlordId: params.landlordId,
        residentId: params.residentId,
        workflowRunId: params.workflowRunId,
        lateFeeDollars: resolveLateFeeDollars(params.lateFeeCents),
      })
      if (!waiver.ok) {
        return {
          ok: false,
          conversationId,
          messageId,
          error: waiver.error ?? "Could not adjust rent balances after late fee waiver.",
          deliverySimulated,
        }
      }
      balanceDueAfterWaiver = waiver.newBalance
      lateFeeWaived = waiver.lateFeeWaived
    }
  }

  const metadataPatch: Record<string, unknown> = {
    conversation_id: conversationId,
  }
  if (params.action === "offer_payment_plan") {
    metadataPatch.payment_plan_sms_sent = true
    metadataPatch.payment_plan_sms_sent_at = now
    if (params.installments != null && Number.isFinite(params.installments)) {
      metadataPatch.payment_plan_installments = params.installments
    }
    if (deliverySimulated) metadataPatch.payment_plan_sms_delivery = "simulated"
  } else {
    metadataPatch.late_fee_waiver_sms_sent = true
    metadataPatch.late_fee_waiver_sms_sent_at = now
    if (deliverySimulated) metadataPatch.late_fee_waiver_sms_delivery = "simulated"
    if (lateFeeWaived != null) metadataPatch.late_fee_waived_amount = lateFeeWaived
    if (balanceDueAfterWaiver != null) {
      metadataPatch.balance_due_after_waiver = balanceDueAfterWaiver
    }
  }

  await updateWorkflowRun(supabase, params.workflowRunId, {
    metadata: metadataPatch,
    eventMessage:
      params.action === "offer_payment_plan"
        ? deliverySimulated
          ? "Payment plan logged to resident SMS thread (demo delivery)"
          : "Payment plan SMS sent to resident"
        : deliverySimulated
          ? "Late fee waiver logged to resident SMS thread (demo delivery); balances adjusted"
          : "Late fee waiver SMS sent; rent balances adjusted",
    eventStep: params.action,
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: eventType,
    source: "dashboard",
    actor_type: "landlord",
    resident_id: params.residentId,
    unit_id: run.unit_id,
    property_id: run.property_id,
    conversation_id: conversationId,
    message_id: messageId,
    workflow_run_id: params.workflowRunId,
    workflow_template_id: "rent_collection",
    metadata: {
      action: params.action,
      message: body,
      channel: "sms",
      delivery: deliverySimulated ? "simulated" : "live",
      ...(params.action === "offer_payment_plan" && params.installments != null
        ? { installments: params.installments }
        : {}),
      ...(params.action === "waive_late_fee"
        ? {
          late_fee_waived: lateFeeWaived,
          balance_due_after_waiver: balanceDueAfterWaiver,
        }
        : {}),
    },
  })

  if (params.action === "waive_late_fee" && lateFeeWaived != null) {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "rent.late_fee_waived",
      source: "dashboard",
      actor_type: "landlord",
      resident_id: params.residentId,
      unit_id: run.unit_id,
      property_id: run.property_id,
      conversation_id: conversationId,
      message_id: messageId,
      workflow_run_id: params.workflowRunId,
      workflow_template_id: "rent_collection",
      metadata: {
        late_fee_waived: lateFeeWaived,
        balance_due_after_waiver: balanceDueAfterWaiver,
      },
    })
  }

  return {
    ok: true,
    conversationId,
    messageId,
    deliverySimulated,
    balanceDueAfterWaiver,
    lateFeeWaived,
  }
}
