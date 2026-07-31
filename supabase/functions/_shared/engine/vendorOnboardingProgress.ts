/**
 * Vendor onboarding workflow progress — step advances shared by invite,
 * verification portal, and escalation (engine-owned pipeline).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import {
  readVendorOnboardingState,
  type VendorOnboardingState,
  type VendorOnboardingStep,
} from "./vendorOnboardingPolicy.ts"
import {
  createWorkflowRun,
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  updateWorkflowRun,
} from "./workflowRuns.ts"
import type { WorkflowRunRow, WorkflowTriggerType } from "./types.ts"

export type {
  VendorOnboardingState,
  VendorOnboardingStep,
} from "./vendorOnboardingPolicy.ts"
export {
  readVendorOnboardingState,
  VENDOR_ONBOARDING_WAITING_STEPS,
  VENDOR_ONBOARDING_TERMINAL_STEPS,
} from "./vendorOnboardingPolicy.ts"

function mergeStepState(
  run: WorkflowRunRow,
  patch: VendorOnboardingState,
): VendorOnboardingState {
  return {
    ...readVendorOnboardingState(run),
    ...patch,
    last_activity_at: patch.last_activity_at ?? new Date().toISOString(),
  }
}

export async function startVendorOnboardingRun(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null
    triggerType?: WorkflowTriggerType
    channel: string
    businessName?: string | null
    contactName?: string | null
    noResponseDays?: number
  },
): Promise<WorkflowRunRow | null> {
  const noResponseDays = params.noResponseDays ?? 5
  const due = new Date()
  due.setDate(due.getDate() + noResponseDays)
  const now = new Date().toISOString()

  return await createWorkflowRun(supabase, {
    templateId: "vendor_onboarding",
    landlordId: params.landlordId,
    triggerType: params.triggerType ?? "dashboard",
    currentStep: "invited",
    metadata: {
      channel: params.channel,
      business_name: params.businessName ?? null,
      contact_name: params.contactName ?? null,
      vendor_id: params.vendorId,
      due_at: due.toISOString(),
      step_state: {
        step: "invited",
        vendor_id: params.vendorId,
        channel: params.channel,
        business_name: params.businessName ?? null,
        contact_name: params.contactName ?? null,
        last_activity_at: now,
        reminder_count: 0,
      } satisfies VendorOnboardingState,
    },
  })
}

export async function markVendorOnboardingInviteDelivered(
  supabase: SupabaseClient,
  params: {
    runId: string
    verificationId: string
    vendorLabel: string
    channel: string
    delivery: Record<string, unknown>
    anyDelivered: boolean
    deliveredVia: string
    conversationId?: string | null
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return

  if (params.conversationId) {
    await linkConversationToWorkflowRun(supabase, {
      conversationId: params.conversationId,
      runId: params.runId,
      templateId: "vendor_onboarding",
    })
  }

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "route",
    step: "classify_channel",
    actorType: "landlord",
    message: `Outreach channel: ${params.channel}.`,
    metadata: { channel: params.channel, verification_id: params.verificationId },
  })

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "act",
    step: "deliver_invite",
    actorType: "landlord",
    message: params.anyDelivered
      ? `Invite delivered to ${params.vendorLabel}${
        params.deliveredVia ? ` via ${params.deliveredVia}` : ""
      }.`
      : `Invite created for ${params.vendorLabel} (delivery pending).`,
    metadata: {
      channel: params.channel,
      delivery: params.delivery,
      verification_id: params.verificationId,
    },
  })

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "log",
    step: "append_graph_events",
    message: "Vendor invite logged to operations graph.",
    metadata: { verification_id: params.verificationId },
  })

  const stepState = mergeStepState(run, {
    step: "invited",
    verification_id: params.verificationId,
    channel: params.channel,
    invite_conversation_id: params.conversationId ?? null,
  })

  await updateWorkflowRun(supabase, params.runId, {
    currentStep: "invited",
    metadata: {
      verification_id: params.verificationId,
      step_state: stepState,
    },
  })
}

/** Portal open / save — vendor started filling the form. */
export async function advanceVendorOnboardingInProgress(
  supabase: SupabaseClient,
  params: {
    runId: string
    verificationId: string
    vendorId?: string | null
    vendorLabel?: string
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.status !== "active") return

  const state = readVendorOnboardingState(run)
  if (
    state.step === "verified" ||
    state.step === "cancelled" ||
    state.step === "submitted" ||
    state.step === "needs_review" ||
    state.step === "in_progress"
  ) {
    if (state.step === "in_progress") {
      await updateWorkflowRun(supabase, params.runId, {
        metadata: {
          step_state: mergeStepState(run, {
            step: "in_progress",
            verification_id: params.verificationId,
            vendor_id: params.vendorId ?? state.vendor_id,
          }),
        },
      })
    }
    return
  }

  const label = params.vendorLabel?.trim() || "Vendor"
  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "act",
    step: "collect_verification",
    actorType: "vendor",
    message: `${label} opened the verification form.`,
    metadata: { verification_id: params.verificationId },
  })

  await updateWorkflowRun(supabase, params.runId, {
    currentStep: "in_progress",
    metadata: {
      verification_id: params.verificationId,
      vendor_id: params.vendorId ?? state.vendor_id,
      step_state: mergeStepState(run, {
        step: "in_progress",
        verification_id: params.verificationId,
        vendor_id: params.vendorId ?? state.vendor_id,
      }),
    },
  })
}

/** Form finalize — verified completes; incomplete stays needs_review. */
export async function advanceVendorOnboardingOnSubmit(
  supabase: SupabaseClient,
  params: {
    runId: string
    verificationId: string
    vendorId: string | null
    vendorLabel: string
    overall: "verified" | "needs_review"
    completeCount: number
    requiredCount: number
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return

  const nextStep: VendorOnboardingStep = params.overall === "verified"
    ? "verified"
    : "needs_review"
  const nowIso = new Date().toISOString()

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "act",
    step: "verify_and_roster",
    actorType: "vendor",
    message:
      `${params.vendorLabel} submitted verification (${params.completeCount}/${params.requiredCount} complete).`,
    metadata: {
      verification_id: params.verificationId,
      overall: params.overall,
    },
  })

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "log",
    step: "append_graph_events",
    message: params.overall === "verified"
      ? `${params.vendorLabel} verified and added to the roster.`
      : `${params.vendorLabel} needs review before roster assignment.`,
    metadata: {
      verification_id: params.verificationId,
      overall: params.overall,
    },
  })

  await updateWorkflowRun(supabase, params.runId, {
    status: params.overall === "verified" ? "completed" : "active",
    currentStep: nextStep,
    completedAt: params.overall === "verified" ? nowIso : null,
    metadata: {
      verification_id: params.verificationId,
      vendor_id: params.vendorId,
      step_state: mergeStepState(run, {
        step: nextStep,
        verification_id: params.verificationId,
        vendor_id: params.vendorId,
      }),
    },
  })
}

export async function recordVendorOnboardingReminder(
  supabase: SupabaseClient,
  params: {
    runId: string
    landlordId: string
    vendorId?: string | null
    conversationId?: string | null
    channel: "sms" | "email" | "both" | "none"
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return

  const now = new Date().toISOString()
  const prev = readVendorOnboardingState(run)
  const reminderCount = (prev.reminder_count ?? 0) + 1

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "act",
    step: "send_reminder",
    message: "Sent a verification reminder to the vendor.",
    metadata: { channel: params.channel, reminder_count: reminderCount },
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.onboarding_reminder_sent",
    source: "automation",
    actor_type: "system",
    vendor_id: params.vendorId ?? prev.vendor_id ?? null,
    conversation_id: params.conversationId ?? prev.invite_conversation_id ?? null,
    workflow_run_id: params.runId,
    workflow_template_id: "vendor_onboarding",
    metadata: {
      message: "Verification reminder sent to the vendor.",
      channel: params.channel,
      reminder_count: reminderCount,
    },
  })

  await updateWorkflowRun(supabase, params.runId, {
    currentStep: prev.step === "needs_review" ? "needs_review" : "reminder_sent",
    metadata: {
      step_state: mergeStepState(run, {
        step: prev.step === "needs_review" ? "needs_review" : "reminder_sent",
        reminder_sent_at: now,
        reminder_count: reminderCount,
      }),
    },
  })
}
