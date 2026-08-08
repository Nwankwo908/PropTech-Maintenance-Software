/**
 * Lifecycle escalation — remind residents, then notify landlord when stuck.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import {
  buildInspectionReminderSms,
  buildMoveInReminderSms,
  buildMoveOutReminderSms,
  lifecycleActionDue,
  LIFECYCLE_TERMINAL_STEPS,
  readLifecycleStepState,
  type LifecycleStepState,
} from "./lifecyclePolicy.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import type { WorkflowRunRow, WorkflowTemplateId } from "./types.ts"

export type LifecycleEscalationResult = {
  workflow_run_id: string
  template_id: string
  action: "reminded" | "escalated" | "skipped"
  reason: string
  sms_sent: boolean
  admin_notified: string[]
  admin_notify_errors: string[]
}

export { lifecycleActionDue } from "./lifecyclePolicy.ts"

function firstName(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim() || ""
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] || "there"
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

async function loadLandlordName(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("name")
    .eq("id", landlordId)
    .maybeSingle()
  const name = typeof data?.name === "string" ? data.name.trim() : ""
  return name || null
}

async function loadResident(
  supabase: SupabaseClient,
  residentId: string | null,
): Promise<{ id: string; full_name: string | null; phone: string | null } | null> {
  if (!residentId) return null
  const { data } = await supabase
    .from("users")
    .select("id, full_name, phone")
    .eq("id", residentId)
    .maybeSingle()
  return data ?? null
}

function reminderBody(
  templateId: string,
  companyName: string | null,
  residentName: string,
  state: LifecycleStepState,
  meta: Record<string, unknown>,
): string {
  if (templateId === "move_in") {
    return buildMoveInReminderSms({ residentName, companyName })
  }
  if (templateId === "move_out") {
    return buildMoveOutReminderSms({
      residentName,
      companyName,
      moveOutDate: state.move_out_date ??
        (typeof meta.move_out_date === "string" ? meta.move_out_date : null),
    })
  }
  return buildInspectionReminderSms({
    residentName,
    companyName,
    scheduledAt: state.scheduled_at ??
      (typeof meta.scheduled_at === "string" ? meta.scheduled_at : null),
  })
}

function headlineFor(templateId: string): string {
  switch (templateId) {
    case "move_in":
      return "Move-in needs attention"
    case "move_out":
      return "Move-out is delayed"
    case "inspection":
      return "Inspection needs attention"
    default:
      return "Workflow needs attention"
  }
}

export async function escalateLifecycleRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    reason: string
    escalationConfig?: Record<string, unknown>
  },
): Promise<LifecycleEscalationResult | null> {
  const { run, landlordId } = params
  const templateId = run.template_id as WorkflowTemplateId
  if (!["move_in", "move_out", "inspection"].includes(templateId)) {
    return null
  }

  const state = readLifecycleStepState(run)
  if (LIFECYCLE_TERMINAL_STEPS.has(state.step ?? "")) {
    return {
      workflow_run_id: run.id,
      template_id: templateId,
      action: "skipped",
      reason: "terminal",
      sms_sent: false,
      admin_notified: [],
      admin_notify_errors: [],
    }
  }

  const config = params.escalationConfig ?? {}
  const defaultsNoResponse = templateId === "move_out"
    ? 7
    : templateId === "inspection"
    ? 3
    : 5
  const noResponseDays = positiveInt(config.no_response_days, defaultsNoResponse)
  const anchor = state.last_activity_at || run.started_at
  const startedDays = daysSince(anchor)
  const alreadyReminded = Boolean(state.reminder_sent_at)

  const companyName = await loadLandlordName(supabase, landlordId)
  const resident = await loadResident(supabase, run.resident_id)
  const phone = resident?.phone?.trim()

  // Prefer resident reminder before landlord escalation.
  if (!alreadyReminded && resident && phone) {
    try {
      const line = await resolveOutboundLandlordSmsLine(supabase, landlordId)
      if (line) {
        const identity = await upsertSmsIdentityForPhone(supabase, {
          landlordId,
          phone,
          identityType: "resident",
          residentId: resident.id,
        })
        if (identity) {
          const { conversationId } = await findOrCreateConversation(supabase, {
            landlordId,
            smsNumberId: line.id,
            externalPhone: phone,
            identity,
            conversationStatus: "open",
          })
          await linkConversationToWorkflowRun(supabase, {
            conversationId,
            runId: run.id,
            templateId,
          })
          const body = reminderBody(
            templateId,
            companyName,
            firstName(resident.full_name),
            state,
            run.metadata ?? {},
          )
          const sent = await sendInboundAutoReply(supabase, {
            conversationId,
            landlordId,
            fromNumber: line.phone,
            toNumber: phone,
            body,
            provider: line.provider,
            source: `workflow_${templateId}_reminder`,
          })
          if (sent.ok) {
            const now = new Date().toISOString()
            const reminderCount = (state.reminder_count ?? 0) + 1
            await logPipelineStageEvent(supabase, {
              runId: run.id,
              stage: "act",
              step: "send_reminder",
              message: "Reminder sent to the resident.",
              metadata: { reminder_count: reminderCount },
            })
            await updateWorkflowRun(supabase, run.id, {
              currentStep: state.step === "awaiting_confirm" ||
                  state.step === "awaiting_vacate" ||
                  state.step === "awaiting_resident"
                ? state.step
                : "reminder_sent",
              metadata: {
                step_state: {
                  ...state,
                  reminder_sent_at: now,
                  reminder_count: reminderCount,
                  last_activity_at: now,
                  conversation_id: conversationId,
                } satisfies LifecycleStepState,
              },
            })
            await logGraphEvent(supabase, {
              landlord_id: landlordId,
              event_type: `${templateId}.reminder_sent`,
              source: "automation",
              actor_type: "system",
              resident_id: run.resident_id,
              unit_id: run.unit_id,
              property_id: run.property_id,
              conversation_id: conversationId,
              workflow_run_id: run.id,
              workflow_template_id: templateId,
              metadata: { message: "Resident reminder sent", reminder_count: reminderCount },
            })
            return {
              workflow_run_id: run.id,
              template_id: templateId,
              action: "reminded",
              reason: "reminder_due",
              sms_sent: true,
              admin_notified: [],
              admin_notify_errors: [],
            }
          }
        }
      }
    } catch (err) {
      console.error(`[${templateId}] reminder failed`, err)
    }
  }

  if (startedDays < noResponseDays && alreadyReminded) {
    return {
      workflow_run_id: run.id,
      template_id: templateId,
      action: "skipped",
      reason: "awaiting_response_after_reminder",
      sms_sent: false,
      admin_notified: [],
      admin_notify_errors: [],
    }
  }

  // Auto-forward stuck lifecycles before terminal escalate.
  let autoForwardedInspection = false
  if (templateId === "move_out") {
    const step = state.step ?? ""
    const canSchedule = [
      "initiated",
      "notice_sent",
      "awaiting_vacate",
      "turnover_in_progress",
      "unit_vacated",
      "reminder_sent",
    ].includes(step)
    if (canSchedule) {
      try {
        const { executeMoveOutScheduleInspection } = await import(
          "./moveOutProgress.ts"
        )
        await executeMoveOutScheduleInspection(supabase, {
          landlordId,
          runId: run.id,
        })
        autoForwardedInspection = true
      } catch (err) {
        console.error("[move_out] auto-schedule inspection failed", err)
      }
    }
  }

  if (templateId === "move_in") {
    try {
      const { scheduleMoveInInspection } = await import("./lifecycleProgress.ts")
      await scheduleMoveInInspection(supabase, {
        landlordId,
        moveInRunId: run.id,
      })
      autoForwardedInspection = true
    } catch (err) {
      console.error("[move_in] auto-schedule inspection failed", err)
    }
  }

  // Escalate to landlord.
  const now = new Date().toISOString()
  const detail = resident?.full_name?.trim()
    ? `${resident.full_name.trim()} · ${state.step ?? "waiting"}`
    : `Unit workflow stuck on ${state.step ?? "waiting"}`

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "escalate",
    step: autoForwardedInspection ? "auto_forward_and_alert" : "escalated",
    message: autoForwardedInspection
      ? `${headlineFor(templateId)} — inspection scheduled and property team alerted.`
      : `${headlineFor(templateId)} — notifying the property team.`,
    metadata: { reason: params.reason, auto_forwarded: autoForwardedInspection },
  })

  // When we auto-scheduled an inspection, keep the parent run active on its
  // forward step (don't overwrite with terminal "escalated").
  if (autoForwardedInspection) {
    const fresh = await getWorkflowRunById(supabase, run.id)
    const freshState = fresh ? readLifecycleStepState(fresh) : state
    await updateWorkflowRun(supabase, run.id, {
      status: "active",
      currentStep: fresh?.current_step ??
        (templateId === "move_out"
          ? "inspection_scheduled"
          : (state.step ?? "awaiting_confirm")),
      metadata: {
        landlord_alerted_at: now,
        escalation_reason: params.reason,
        step_state: {
          ...freshState,
          escalated_at: now,
          escalation_reason: params.reason,
          last_activity_at: now,
        } satisfies LifecycleStepState,
      },
    })
  } else {
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
        } satisfies LifecycleStepState,
      },
    })
  }

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: `${templateId}.${LIFECYCLE_GRAPH_EVENTS.escalated}`,
    source: "automation",
    actor_type: "system",
    resident_id: run.resident_id,
    unit_id: run.unit_id,
    property_id: run.property_id,
    workflow_run_id: run.id,
    workflow_template_id: templateId,
    metadata: {
      reason: params.reason,
      message: detail,
      auto_forwarded_inspection: autoForwardedInspection,
    },
  })

  try {
    const attention = await notifyLandlordNeedsAttention(supabase, {
      landlordId,
      kind: "workflow_escalated",
      headline: headlineFor(templateId),
      detail,
      idempotencyKey: `workflow:${run.id}:${templateId}_escalated`,
      workflowRunId: run.id,
      residentId: run.resident_id,
      unitId: run.unit_id,
    })
    return {
      workflow_run_id: run.id,
      template_id: templateId,
      action: "escalated",
      reason: autoForwardedInspection
        ? "auto_forwarded_inspection"
        : params.reason,
      sms_sent: false,
      admin_notified: [...attention.smsSent, ...attention.emailSent],
      admin_notify_errors: attention.errors,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      workflow_run_id: run.id,
      template_id: templateId,
      action: "escalated",
      reason: autoForwardedInspection
        ? "auto_forwarded_inspection"
        : params.reason,
      sms_sent: false,
      admin_notified: [],
      admin_notify_errors: [message],
    }
  }
}

/** Re-load run then escalate (for template.escalate hooks). */
export async function escalateLifecycleRunById(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    reason: string
    escalationConfig?: Record<string, unknown>
  },
): Promise<LifecycleEscalationResult | null> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return null
  return escalateLifecycleRun(supabase, {
    landlordId: params.landlordId,
    run,
    reason: params.reason,
    escalationConfig: params.escalationConfig,
  })
}
