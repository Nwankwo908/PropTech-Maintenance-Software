/**
 * Vendor onboarding escalation — remind stalled vendors, then notify landlord.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import { loadLandlordDisplayName } from "../landlordDisplayName.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import type { SmsProviderName } from "../sms/types.ts"
import {
  buildVendorOnboardingReminderEmail,
  buildVendorOnboardingReminderSms,
  readVendorOnboardingState,
  vendorOnboardingActionDue,
  VENDOR_ONBOARDING_TERMINAL_STEPS,
  type VendorOnboardingState,
} from "./vendorOnboardingPolicy.ts"
import { recordVendorOnboardingReminder } from "./vendorOnboardingProgress.ts"
import {
  logPipelineStageEvent,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import type { WorkflowRunRow } from "./types.ts"
import { uloAppUrl } from "../uloAppUrl.ts"

export {
  vendorOnboardingActionDue,
  buildVendorOnboardingReminderSms,
  buildVendorOnboardingReminderEmail,
} from "./vendorOnboardingPolicy.ts"

export type VendorOnboardingEscalationResult = {
  workflow_run_id: string
  action: "reminded" | "escalated" | "skipped"
  reason: string
  sms_sent: boolean
  email_sent: boolean
  admin_notified: string[]
  admin_notify_errors: string[]
}

type VerificationContactRow = {
  id: string
  token: string
  business_name: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  vendor_id: string | null
  invite_conversation_id: string | null
  status: string | null
}


function positiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function daysSince(iso: string, now = new Date()): number {
  const start = new Date(iso)
  if (Number.isNaN(start.getTime())) return 0
  return (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
}

function vendorLabel(row: VerificationContactRow): string {
  return (
    row.business_name?.trim() ||
    row.contact_name?.trim() ||
    "there"
  )
}




async function loadVerificationForRun(
  supabase: SupabaseClient,
  run: WorkflowRunRow,
  state: VendorOnboardingState,
): Promise<VerificationContactRow | null> {
  const verificationId = state.verification_id?.trim()
  if (verificationId) {
    const { data } = await supabase
      .from("vendor_verifications")
      .select(
        "id, token, business_name, contact_name, email, phone, vendor_id, invite_conversation_id, status",
      )
      .eq("id", verificationId)
      .maybeSingle()
    if (data) return data as VerificationContactRow
  }

  const { data } = await supabase
    .from("vendor_verifications")
    .select(
      "id, token, business_name, contact_name, email, phone, vendor_id, invite_conversation_id, status",
    )
    .eq("workflow_run_id", run.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as VerificationContactRow | null) ?? null
}

async function sendReminderChannels(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    row: VerificationContactRow
    companyName: string | null
    needsReview: boolean
  },
): Promise<{ sms: boolean; email: boolean; conversationId: string | null }> {
  const link = uloAppUrl.vendorVerification(params.row.token)
  const label = vendorLabel(params.row)
  let sms = false
  let email = false
  let conversationId = params.row.invite_conversation_id

  const phone = params.row.phone?.trim()
  if (phone) {
    try {
      const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
      if (line) {
        const provider: SmsProviderName = line.provider === "telnyx"
          ? "telnyx"
          : "twilio"
        const identity = await upsertSmsIdentityForPhone(supabase, {
          landlordId: params.landlordId,
          phone,
          identityType: "vendor",
          vendorId: params.row.vendor_id,
        })
        if (identity) {
          const convo = await findOrCreateConversation(supabase, {
            landlordId: params.landlordId,
            smsNumberId: line.id,
            externalPhone: phone,
            identity,
            conversationStatus: "open",
          })
          conversationId = convo.conversationId
          const sent = await sendInboundAutoReply(supabase, {
            conversationId: convo.conversationId,
            landlordId: params.landlordId,
            fromNumber: line.phone,
            toNumber: phone,
            body: buildVendorOnboardingReminderSms({
              vendorLabel: label,
              companyName: params.companyName,
              link,
              needsReview: params.needsReview,
            }),
            provider,
            source: "vendor_onboarding_reminder",
          })
          sms = sent.ok
        }
      }
    } catch (err) {
      console.error("[vendor-onboarding] reminder sms failed", err)
    }
  }

  const emailAddr = params.row.email?.trim()
  if (emailAddr) {
    const copy = buildVendorOnboardingReminderEmail({
      vendorLabel: label,
      companyName: params.companyName,
      link,
      needsReview: params.needsReview,
    })
    const res = await sendResendEmail(emailAddr, copy.subject, copy.text, copy.html)
    email = !("error" in res)
    if ("error" in res) {
      console.error("[vendor-onboarding] reminder email failed", res.error)
    }
  }

  return { sms, email, conversationId }
}


/**
 * Remind the vendor once, then escalate to the landlord if still stuck.
 */
export async function escalateVendorOnboardingRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    reason: string
    escalationConfig?: Record<string, unknown>
  },
): Promise<VendorOnboardingEscalationResult | null> {
  const { run, landlordId } = params
  const state = readVendorOnboardingState(run)
  if (VENDOR_ONBOARDING_TERMINAL_STEPS.has(state.step ?? "")) {
    return {
      workflow_run_id: run.id,
      action: "skipped",
      reason: "terminal",
      sms_sent: false,
      email_sent: false,
      admin_notified: [],
      admin_notify_errors: [],
    }
  }

  const config = params.escalationConfig ?? {}
  const due = vendorOnboardingActionDue(run, config)
  if (!due.due && params.reason !== "reminder_due") {
    // Still allow when cron candidate finder marked due.
  }

  const verification = await loadVerificationForRun(supabase, run, state)
  const companyName = await loadLandlordDisplayName(supabase, landlordId)
  const needsReview = state.step === "needs_review" ||
    verification?.status === "needs_review"
  const noResponseDays = positiveInt(config.no_response_days, 5)
  const startedDays = daysSince(run.started_at)
  const alreadyReminded = Boolean(state.reminder_sent_at)

  // Prefer a vendor reminder before landlord escalation.
  if (!alreadyReminded && verification?.token) {
    const sent = await sendReminderChannels(supabase, {
      landlordId,
      row: verification,
      companyName,
      needsReview,
    })
    const channel = sent.sms && sent.email
      ? "both"
      : sent.sms
      ? "sms"
      : sent.email
      ? "email"
      : "none"

    if (sent.sms || sent.email) {
      await recordVendorOnboardingReminder(supabase, {
        runId: run.id,
        landlordId,
        vendorId: verification.vendor_id,
        conversationId: sent.conversationId,
        channel,
      })
      return {
        workflow_run_id: run.id,
        action: "reminded",
        reason: "reminder_due",
        sms_sent: sent.sms,
        email_sent: sent.email,
        admin_notified: [],
        admin_notify_errors: [],
      }
    }
  }

  if (startedDays < noResponseDays && alreadyReminded) {
    return {
      workflow_run_id: run.id,
      action: "skipped",
      reason: "awaiting_response_after_reminder",
      sms_sent: false,
      email_sent: false,
      admin_notified: [],
      admin_notify_errors: [],
    }
  }

  // Escalate to landlord — vendor still stuck.
  const now = new Date().toISOString()
  const label = verification
    ? vendorLabel(verification)
    : state.business_name?.trim() || "Vendor"

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "escalate",
    step: "escalated",
    message: `${label} verification is stalled — notifying the property team.`,
    metadata: {
      reason: params.reason,
      verification_id: verification?.id ?? state.verification_id,
    },
  })

  await updateWorkflowRun(supabase, run.id, {
    status: "escalated",
    currentStep: "escalated",
    metadata: {
      escalated_at: now,
      escalation_reason: params.reason,
      step_state: {
        ...state,
        step: "escalated",
        escalated_at: now,
        escalation_reason: params.reason,
        last_activity_at: now,
      } satisfies VendorOnboardingState,
    },
  })

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "vendor.onboarding_escalated",
    source: "automation",
    actor_type: "system",
    vendor_id: verification?.vendor_id ?? state.vendor_id ?? null,
    conversation_id: verification?.invite_conversation_id ??
      state.invite_conversation_id ?? null,
    workflow_run_id: run.id,
    workflow_template_id: "vendor_onboarding",
    metadata: {
      reason: params.reason,
      message: `${label} has not finished verification.`,
      verification_id: verification?.id ?? null,
    },
  })

  try {
    const attention = await notifyLandlordNeedsAttention(supabase, {
      landlordId,
      kind: "workflow_escalated",
      headline: "Vendor verification needs attention",
      detail: `${label} has not finished verification`,
      idempotencyKey: `workflow:${run.id}:vendor_onboarding_escalated`,
      workflowRunId: run.id,
    })
    return {
      workflow_run_id: run.id,
      action: "escalated",
      reason: params.reason,
      sms_sent: false,
      email_sent: false,
      admin_notified: [...attention.smsSent, ...attention.emailSent],
      admin_notify_errors: attention.errors,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      workflow_run_id: run.id,
      action: "escalated",
      reason: params.reason,
      sms_sent: false,
      email_sent: false,
      admin_notified: [],
      admin_notify_errors: [message],
    }
  }
}
