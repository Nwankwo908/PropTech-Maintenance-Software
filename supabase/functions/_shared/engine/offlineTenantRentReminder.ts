/**
 * Limited Alpha: tenant rent reminders only after the landlord marks unpaid/partial,
 * and only during the grace window. No Stripe / pay-online links.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { smsProviderNameForSend } from "../sms/providerFactory.ts"
import type { SmsProviderName } from "../sms/types.ts"
import { rentCollectionGraphScopeFromRun } from "./rentCollectionGraph.ts"
import {
  buildOfflineTenantGraceReminderEmail,
  buildOfflineTenantGraceReminderSms,
} from "./rentCollectionOutreachCopy.ts"
import { shouldSendOfflineTenantGraceReminder } from "./rentCollectionPolicy.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  runAmountDue,
  runDueAt,
  runStepState,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import type { RentCollectionState } from "./templates/rentCollection.ts"

function todayIso(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

async function lookupLandlordMainNumber(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ phone: string; id: string; provider: SmsProviderName } | null> {
  const { data } = await supabase
    .from("sms_numbers")
    .select("id, phone_number, provider")
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

  if (!data?.phone_number || !data?.id) return null
  const provider = (data.provider === "telnyx" ? "telnyx" : "twilio") as SmsProviderName
  return {
    phone: String(data.phone_number).trim(),
    id: String(data.id),
    provider,
  }
}

export async function maybeSendOfflineTenantGraceReminder(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    resident: {
      id: string
      full_name: string | null
      email: string | null
      phone: string | null
      unit: string | null
    }
  },
): Promise<{ smsSent: boolean; emailSent: boolean }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return { smsSent: false, emailSent: false }

  const state = runStepState<RentCollectionState>(run)
  const amountDue = runAmountDue(run) ?? state.amount_due ?? 0
  const rentStatus = typeof run.metadata?.rent_status === "string"
    ? run.metadata.rent_status
    : null
  const reminderDates = Array.isArray(run.metadata?.tenant_grace_reminder_dates)
    ? (run.metadata.tenant_grace_reminder_dates as unknown[]).filter(
      (d): d is string => typeof d === "string",
    )
    : state.tenant_grace_reminder_dates ?? []
  const stopped = run.metadata?.tenant_grace_reminders_stopped === true

  if (
    !shouldSendOfflineTenantGraceReminder({
      rentStatus,
      runStatus: run.status,
      amountDue,
      dueAt: runDueAt(run),
      reminderDates,
      remindersStopped: stopped,
    })
  ) {
    return { smsSent: false, emailSent: false }
  }

  const remaining = (rentStatus ?? "").toLowerCase() === "partial"
  const smsBody = buildOfflineTenantGraceReminderSms({
    amountDue,
    rentDueDate: state.rent_due_date ??
      (typeof run.metadata?.rent_due_date === "string" ? run.metadata.rent_due_date : null),
    remaining,
  })
  const emailCopy = buildOfflineTenantGraceReminderEmail({
    amountDue,
    rentDueDate: state.rent_due_date ??
      (typeof run.metadata?.rent_due_date === "string" ? run.metadata.rent_due_date : null),
    residentName: params.resident.full_name,
    remaining,
  })

  let smsSent = false
  let emailSent = false
  const phone = String(params.resident.phone ?? "").trim()
  const email = String(params.resident.email ?? "").trim()
  const main = phone ? await lookupLandlordMainNumber(supabase, params.landlordId) : null

  if (phone && main) {
    const identity = await upsertSmsIdentityForPhone(supabase, {
      phone,
      landlordId: params.landlordId,
      identityType: "resident",
      residentId: params.resident.id,
    })
    if (identity) {
      const { conversationId } = await findOrCreateConversation(supabase, {
        landlordId: params.landlordId,
        smsNumberId: main.id,
        externalPhone: phone,
        identity,
        maintenanceRequestId: null,
        conversationStatus: "open",
      })
      await linkConversationToWorkflowRun(supabase, {
        conversationId,
        runId: params.runId,
        templateId: "rent_collection",
      })
      const provider = smsProviderNameForSend({
        landlordId: params.landlordId,
        lineProvider: main.provider,
      })
      const sent = await sendInboundAutoReply(supabase, {
        conversationId,
        landlordId: params.landlordId,
        fromNumber: main.phone,
        toNumber: phone,
        body: smsBody,
        provider,
        source: "workflow_rent_grace_reminder",
      })
      smsSent = sent.ok
    }
  }

  if (email) {
    const result = await sendResendEmail(email, emailCopy.subject, emailCopy.text, emailCopy.html)
    emailSent = !("error" in result)
  }

  if (!smsSent && !emailSent) return { smsSent: false, emailSent: false }

  const today = todayIso()
  const nextDates = [...new Set([...reminderDates, today])]
  await updateWorkflowRun(supabase, params.runId, {
    metadata: {
      tenant_grace_reminder_dates: nextDates,
      tenant_grace_reminders_enabled: true,
      step_state: {
        ...state,
        tenant_grace_reminder_dates: nextDates,
        sms_sent: smsSent || state.sms_sent,
        email_sent: emailSent || state.email_sent,
      },
    },
    pipelineStage: "act",
    eventMessage: remaining
      ? "Sent remaining-balance rent reminder to the resident"
      : "Sent rent reminder to the resident",
    eventStep: "payment_reminder_sent",
  })

  const scope = rentCollectionGraphScopeFromRun(run, params.landlordId)
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "rent.reminder_sent",
    source: "automation",
    actorType: "system",
    residentId: params.resident.id,
    unitId: scope.unitId,
    propertyId: scope.propertyId,
    workflowRunId: params.runId,
    workflowTemplateId: "rent_collection",
    metadata: {
      message: remaining
        ? `Reminded the resident that ${amountDue} remaining rent is still due.`
        : `Reminded the resident that rent is still due.`,
      amount_due: amountDue,
      sms_sent: smsSent,
      email_sent: emailSent,
      notice_type: "grace_reminder",
      remaining,
    },
  })

  return { smsSent, emailSent }
}
