/**
 * Vendor onboarding silence follow-up — 48-hour reminders while the form is open.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import { loadLandlordDisplayName } from "../landlordDisplayName.ts"
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
  vendorOnboardingFormWasSubmitted,
  type VendorOnboardingState,
} from "./vendorOnboardingPolicy.ts"
import { recordVendorOnboardingReminder } from "./vendorOnboardingProgress.ts"
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
        const provider: SmsProviderName = "twilio"
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
 * Repeat 48-hour verification reminders while the vendor has not submitted.
 * After the silence cap, stop auto-nudge; the invite stays open.
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
  if (!due.due) {
    return {
      workflow_run_id: run.id,
      action: "skipped",
      reason: due.reason,
      sms_sent: false,
      email_sent: false,
      admin_notified: [],
      admin_notify_errors: [],
    }
  }

  const verification = await loadVerificationForRun(supabase, run, state)
  const vendorIdForHold =
    verification?.vendor_id?.trim() || state.vendor_id?.trim() || ""
  if (vendorIdForHold) {
    const { data: vendorRow } = await supabase
      .from("vendors")
      .select("onboarding_overridden_at")
      .eq("id", vendorIdForHold)
      .eq("landlord_id", landlordId)
      .maybeSingle()
    const overridden = Boolean(
      typeof vendorRow?.onboarding_overridden_at === "string" &&
        vendorRow.onboarding_overridden_at.trim(),
    )
    if (overridden) {
      return {
        workflow_run_id: run.id,
        action: "skipped",
        reason: "onboarding_overridden",
        sms_sent: false,
        email_sent: false,
        admin_notified: [],
        admin_notify_errors: [],
      }
    }
  }
  if (vendorOnboardingFormWasSubmitted(state.step, verification?.status)) {
    return {
      workflow_run_id: run.id,
      action: "skipped",
      reason: "form_already_submitted",
      sms_sent: false,
      email_sent: false,
      admin_notified: [],
      admin_notify_errors: [],
    }
  }

  if (!verification?.token) {
    return {
      workflow_run_id: run.id,
      action: "skipped",
      reason: "missing_verification_token",
      sms_sent: false,
      email_sent: false,
      admin_notified: [],
      admin_notify_errors: [],
    }
  }

  const companyName = await loadLandlordDisplayName(supabase, landlordId)
  const sent = await sendReminderChannels(supabase, {
    landlordId,
    row: verification,
    companyName,
    needsReview: false,
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

  return {
    workflow_run_id: run.id,
    action: "skipped",
    reason: "reminder_send_failed",
    sms_sent: false,
    email_sent: false,
    admin_notified: [],
    admin_notify_errors: [],
  }
}
