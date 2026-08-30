/**
 * Vendor onboarding workflow progress — step advances shared by invite,
 * verification portal, and escalation (engine-owned pipeline).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
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

  const { error: templateErr } = await supabase.from("workflow_templates").upsert(
    {
      id: "vendor_onboarding",
      name: "Vendor Onboarding",
      type: "vendor",
      description:
        "Vendor verification onboarding: invite, collect documents, and add to the roster.",
      trigger_config: { primary_trigger: "dashboard" },
      route_config: { handler: "vendor_onboarding", domain: "vendor" },
      escalation_config: { no_response_days: 5 },
      active: true,
    },
    { onConflict: "id" },
  )
  if (templateErr) {
    console.warn("[vendor-onboarding] ensure template", templateErr.message)
  }

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

/** Invite never reached the vendor — drop the run so it does not sit on Active Tasks. */
export async function abortFailedVendorOnboardingInvite(
  supabase: SupabaseClient,
  params: {
    runId: string
    landlordId: string
    vendorId: string | null
    vendorLabel: string
    verificationId?: string | null
    delivery?: Record<string, unknown> | null
  },
): Promise<void> {
  if (params.verificationId) {
    await supabase.from("vendor_verifications").delete().eq("id", params.verificationId)
  } else {
    await supabase
      .from("vendor_verifications")
      .delete()
      .eq("workflow_run_id", params.runId)
  }

  await updateWorkflowRun(supabase, params.runId, {
    status: "cancelled",
    currentStep: "cancelled",
    completedAt: new Date().toISOString(),
    metadata: {
      cancelled_reason: "invite_delivery_failed",
      delivery: params.delivery ?? null,
    },
  })

  try {
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "vendor.invite_failed",
      source: "dashboard",
      actorType: "landlord",
      vendorId: params.vendorId,
      workflowRunId: params.runId,
      workflowTemplateId: "vendor_onboarding",
      metadata: {
        message: `Verification invite could not be sent to ${params.vendorLabel}.`,
        delivery: params.delivery ?? null,
      },
    })
  } catch (err) {
    console.error("[abortFailedVendorOnboardingInvite] activity log failed", err)
  }
}

export async function markVendorOnboardingInviteDelivered(
  supabase: SupabaseClient,
  params: {
    runId: string | null
    verificationId: string
    vendorLabel: string
    channel: string
    delivery: Record<string, unknown>
    anyDelivered: boolean
    deliveredVia: string
    conversationId?: string | null
  },
): Promise<void> {
  const runId = params.runId?.trim() || ""
  if (!runId) return
  const run = await getWorkflowRunById(supabase, runId)
  if (!run) return

  if (params.conversationId) {
    await linkConversationToWorkflowRun(supabase, {
      conversationId: params.conversationId,
      runId,
      templateId: "vendor_onboarding",
    })
  }

  await logPipelineStageEvent(supabase, {
    runId,
    stage: "route",
    step: "classify_channel",
    actorType: "landlord",
    message: `Outreach channel: ${params.channel}.`,
    metadata: { channel: params.channel, verification_id: params.verificationId },
  })

  await logPipelineStageEvent(supabase, {
    runId,
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
    runId,
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

  await updateWorkflowRun(supabase, runId, {
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

/** Admin approved a needs_review vendor — complete the onboarding run. */
export async function advanceVendorOnboardingAdminApprove(
  supabase: SupabaseClient,
  params: {
    runId: string
    verificationId: string
    vendorId: string | null
    vendorLabel: string
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return

  const nowIso = new Date().toISOString()

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "act",
    step: "verify_and_roster",
    actorType: "landlord",
    message: `${params.vendorLabel} was approved and added to the active roster.`,
    metadata: {
      verification_id: params.verificationId,
      approved_by_admin: true,
    },
  })

  await logPipelineStageEvent(supabase, {
    runId: params.runId,
    stage: "log",
    step: "append_graph_events",
    message: `${params.vendorLabel} verified and added to the roster.`,
    metadata: { verification_id: params.verificationId },
  })

  await updateWorkflowRun(supabase, params.runId, {
    status: "completed",
    currentStep: "verified",
    completedAt: nowIso,
    metadata: {
      verification_id: params.verificationId,
      vendor_id: params.vendorId,
      step_state: mergeStepState(run, {
        step: "verified",
        verification_id: params.verificationId,
        vendor_id: params.vendorId,
      }),
    },
  })
}

/**
 * Landlord Override onboarding — close the verification workflow so Ulo
 * stops asking the vendor to finish the form. Does not mark documents verified.
 */
export async function completeVendorOnboardingAfterOverride(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    vendorLabel?: string
  },
): Promise<number> {
  const { data: runs, error } = await supabase
    .from("workflow_runs")
    .select("id, metadata, current_step, status")
    .eq("landlord_id", params.landlordId)
    .eq("template_id", "vendor_onboarding")
    .in("status", ["active", "escalated"])

  if (error) {
    console.error("[vendor-onboarding] list runs for override", error.message)
    return 0
  }

  const vendorId = params.vendorId.trim()
  const matching = (runs ?? []).filter((row) => {
    const rec = row as Record<string, unknown>
    const metadata = rec.metadata && typeof rec.metadata === "object"
      ? rec.metadata as Record<string, unknown>
      : {}
    const stepState = metadata.step_state && typeof metadata.step_state === "object"
      ? metadata.step_state as Record<string, unknown>
      : {}
    const ids = [
      metadata.vendor_id,
      stepState.vendor_id,
      rec.entity_id,
    ]
    return ids.some((id) => typeof id === "string" && id.trim() === vendorId)
  })

  const label = params.vendorLabel?.trim() || "Vendor"
  let completed = 0
  for (const row of matching) {
    const runId = typeof row.id === "string" ? row.id : ""
    if (!runId) continue
    const run = await getWorkflowRunById(supabase, runId)
    if (!run) continue
    const nowIso = new Date().toISOString()
    await logPipelineStageEvent(supabase, {
      runId,
      stage: "act",
      step: "override_activated",
      actorType: "landlord",
      message: `${label} was activated without finishing the verification form.`,
      metadata: { vendor_id: vendorId, onboarding_overridden: true },
    })
    await updateWorkflowRun(supabase, runId, {
      status: "completed",
      currentStep: "verified",
      completedAt: nowIso,
      metadata: {
        vendor_id: vendorId,
        onboarding_overridden: true,
        step_state: mergeStepState(run, {
          step: "verified",
          vendor_id: vendorId,
        }),
      },
    })
    completed += 1
  }
  return completed
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
