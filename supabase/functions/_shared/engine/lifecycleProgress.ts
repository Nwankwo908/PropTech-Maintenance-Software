/**
 * Lifecycle workflow progress — auto-forward after start, outreach, complete.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import { sendMoveOutOutreach } from "../move_out_outreach.ts"
import {
  buildInspectionNoticeSms,
  buildMoveInWelcomeSms,
  readLifecycleStepState,
  type LifecycleStep,
  type LifecycleStepState,
} from "./lifecyclePolicy.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  logWorkflowEvent,
  updateWorkflowRun,
  type WorkflowRunRow,
} from "./workflowRuns.ts"
import type { WorkflowTemplateId } from "./types.ts"

type ResidentContact = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  unit: string | null
}

function firstName(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim() || ""
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] || "there"
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
  residentId: string | null | undefined,
): Promise<ResidentContact | null> {
  if (!residentId) return null
  const { data } = await supabase
    .from("users")
    .select("id, full_name, phone, email, unit")
    .eq("id", residentId)
    .maybeSingle()
  return (data as ResidentContact | null) ?? null
}

function mergeStepState(
  run: WorkflowRunRow,
  patch: LifecycleStepState,
): LifecycleStepState {
  return {
    ...readLifecycleStepState(run),
    ...patch,
    last_activity_at: patch.last_activity_at ?? new Date().toISOString(),
  }
}

async function sendResidentSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    phone: string
    body: string
    runId: string
    templateId: WorkflowTemplateId
    source: string
  },
): Promise<{ ok: boolean; conversationId: string | null }> {
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line) return { ok: false, conversationId: null }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.phone,
    identityType: "resident",
    residentId: params.residentId,
  })
  if (!identity) return { ok: false, conversationId: null }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: line.id,
    externalPhone: params.phone,
    identity,
    conversationStatus: "open",
  })

  await linkConversationToWorkflowRun(supabase, {
    conversationId,
    runId: params.runId,
    templateId: params.templateId,
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: line.phone,
    toNumber: params.phone,
    body: params.body,
    provider: line.provider,
    source: params.source,
  })

  return { ok: sent.ok, conversationId }
}

async function advanceRun(
  supabase: SupabaseClient,
  params: {
    run: WorkflowRunRow
    step: LifecycleStep
    stage?: "classify" | "route" | "act" | "log"
    eventStep: string
    message: string
    graphEventType?: string
    landlordId: string
    patch?: LifecycleStepState
    status?: "active" | "completed"
  },
): Promise<void> {
  const now = new Date().toISOString()
  await logPipelineStageEvent(supabase, {
    runId: params.run.id,
    stage: params.stage ?? "act",
    step: params.eventStep,
    message: params.message,
    metadata: { step: params.step },
  })

  await updateWorkflowRun(supabase, params.run.id, {
    status: params.status ?? "active",
    currentStep: params.step,
    completedAt: params.status === "completed" ? now : null,
    metadata: {
      step_state: mergeStepState(params.run, {
        step: params.step,
        ...(params.patch ?? {}),
      }),
    },
  })

  if (params.graphEventType) {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: params.graphEventType,
      source: "automation",
      actor_type: "system",
      resident_id: params.run.resident_id,
      unit_id: params.run.unit_id,
      property_id: params.run.property_id,
      workflow_run_id: params.run.id,
      workflow_template_id: params.run.template_id,
      metadata: { message: params.message, step: params.step },
    })
  }
}

/**
 * After a lifecycle run is created, automatically classify + send outreach +
 * advance to the waiting step (engine-owned forward motion).
 */
export async function executeLifecycleInitialAct(
  supabase: SupabaseClient,
  params: { landlordId: string; runId: string },
): Promise<{ ok: boolean; step: string; outreachSent: boolean }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.status !== "active") {
    return { ok: false, step: "missing", outreachSent: false }
  }

  const templateId = run.template_id
  const companyName = await loadLandlordName(supabase, params.landlordId)
  const resident = await loadResident(supabase, run.resident_id)
  const state = readLifecycleStepState(run)

  // Idempotent: skip if the run already left the start step.
  if (templateId === "move_in") {
    const step = state.step ?? "initiated"
    if (step !== "initiated" && step !== "occupancy_registered") {
      return { ok: true, step, outreachSent: false }
    }
  } else if (templateId === "move_out") {
    const step = state.step ?? "initiated"
    if (step !== "initiated") {
      return { ok: true, step, outreachSent: false }
    }
  } else if (templateId === "inspection") {
    const step = state.step ?? "scheduled"
    if (step !== "scheduled" && step !== "initiated") {
      return { ok: true, step, outreachSent: false }
    }
  }

  if (templateId === "move_in") {
    await logPipelineStageEvent(supabase, {
      runId: run.id,
      stage: "classify",
      step: "classify_move_in",
      message: "Classified as new move-in occupancy.",
    })

    let outreachSent = false
    let conversationId: string | null = null
    const phone = resident?.phone?.trim()
    if (resident && phone) {
      const body = buildMoveInWelcomeSms({
        residentName: firstName(resident.full_name),
        companyName,
        unitLabel: state.move_in_date
          ? (typeof run.metadata?.unit_label === "string"
            ? run.metadata.unit_label
            : resident.unit)
          : (typeof run.metadata?.unit_label === "string"
            ? run.metadata.unit_label
            : resident.unit),
        moveInDate: state.move_in_date ??
          (typeof run.metadata?.move_in_date === "string"
            ? run.metadata.move_in_date
            : null),
      })
      const sent = await sendResidentSms(supabase, {
        landlordId: params.landlordId,
        residentId: resident.id,
        phone,
        body,
        runId: run.id,
        templateId: "move_in",
        source: "workflow_move_in_outreach",
      })
      outreachSent = sent.ok
      conversationId = sent.conversationId
    }

    const next: LifecycleStep = outreachSent ? "awaiting_confirm" : "checklist_sent"
    await advanceRun(supabase, {
      run,
      landlordId: params.landlordId,
      step: next,
      eventStep: outreachSent ? "send_welcome_outreach" : "create_checklist_tasks",
      message: outreachSent
        ? "Welcome instructions sent to the resident."
        : "Move-in checklist ready (no resident phone on file).",
      graphEventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.checklistSent}`,
      patch: {
        conversation_id: conversationId,
        reminder_count: 0,
      },
    })

    if (outreachSent) {
      await logWorkflowEvent(supabase, {
        workflowRunId: run.id,
        eventType: `move_in.${LIFECYCLE_GRAPH_EVENTS.checklistSent}`,
        step: "checklist_sent",
        actorType: "system",
        message: "Move-in welcome checklist sent",
      })
    }

    return { ok: true, step: next, outreachSent }
  }

  if (templateId === "move_out") {
    await logPipelineStageEvent(supabase, {
      runId: run.id,
      stage: "classify",
      step: "classify_move_out",
      message: "Classified move-out workflow.",
    })

    let outreachSent = false
    let conversationId: string | null = null
    const phone = resident?.phone?.trim()
    if (resident && phone) {
      const result = await sendMoveOutOutreach(supabase, {
        landlordId: params.landlordId,
        residentId: resident.id,
        residentPhone: phone,
        residentFirstName: firstName(resident.full_name),
        moveOutRunId: run.id,
        moveOutDate: state.move_out_date ??
          (typeof run.metadata?.move_out_date === "string"
            ? run.metadata.move_out_date
            : null),
        unitId: run.unit_id,
        propertyId: run.property_id,
      })
      outreachSent = result.ok
      conversationId = result.conversationId
    }

    const next: LifecycleStep = "awaiting_vacate"
    await advanceRun(supabase, {
      run,
      landlordId: params.landlordId,
      step: next,
      eventStep: "send_move_out_instructions",
      message: outreachSent
        ? "Move-out instructions sent to the resident."
        : "Move-out workflow waiting (no resident phone on file).",
      graphEventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.noticeSent}`,
      patch: {
        conversation_id: conversationId,
        reminder_count: 0,
      },
    })

    // Also stamp notice_sent milestone for Admin timeline.
    const fresh = await getWorkflowRunById(supabase, run.id)
    if (fresh) {
      const meta = fresh.metadata ?? {}
      const milestones =
        meta.milestones && typeof meta.milestones === "object"
          ? { ...(meta.milestones as Record<string, unknown>) }
          : {}
      const checklist =
        meta.checklist && typeof meta.checklist === "object"
          ? { ...(meta.checklist as Record<string, unknown>) }
          : {}
      const now = new Date().toISOString()
      await updateWorkflowRun(supabase, run.id, {
        currentStep: next,
        metadata: {
          milestones: {
            ...milestones,
            move_out_started: milestones.move_out_started ?? now,
            instructions_sent: now,
          },
          checklist: {
            ...checklist,
            resident_notified: outreachSent,
            instructions_delivered: outreachSent,
          },
        },
      })
    }

    return { ok: true, step: next, outreachSent }
  }

  if (templateId === "inspection") {
    await logPipelineStageEvent(supabase, {
      runId: run.id,
      stage: "classify",
      step: "classify_inspection",
      message: "Classified inspection workflow.",
    })

    let outreachSent = false
    let conversationId: string | null = null
    const phone = resident?.phone?.trim()
    const scheduledAt = state.scheduled_at ??
      (typeof run.metadata?.scheduled_at === "string"
        ? run.metadata.scheduled_at
        : null)
    const inspectionType = state.inspection_type ??
      (typeof run.metadata?.inspection_type === "string"
        ? run.metadata.inspection_type
        : "periodic")

    if (resident && phone) {
      const body = buildInspectionNoticeSms({
        residentName: firstName(resident.full_name),
        companyName,
        scheduledAt,
        inspectionType,
      })
      const sent = await sendResidentSms(supabase, {
        landlordId: params.landlordId,
        residentId: resident.id,
        phone,
        body,
        runId: run.id,
        templateId: "inspection",
        source: "workflow_inspection_notice",
      })
      outreachSent = sent.ok
      conversationId = sent.conversationId
    }

    const next: LifecycleStep = outreachSent ? "awaiting_resident" : "notice_sent"
    await advanceRun(supabase, {
      run,
      landlordId: params.landlordId,
      step: next,
      eventStep: "send_inspection_notice",
      message: outreachSent
        ? "Inspection notice sent to the resident."
        : "Inspection scheduled (no resident phone on file).",
      graphEventType: `inspection.${LIFECYCLE_GRAPH_EVENTS.noticeSent}`,
      patch: {
        conversation_id: conversationId,
        scheduled_at: scheduledAt,
        inspection_type: inspectionType,
        reminder_count: 0,
      },
    })

    return { ok: true, step: next, outreachSent }
  }

  return { ok: false, step: run.current_step ?? "unknown", outreachSent: false }
}

/** Mark lifecycle workflow complete (engine-owned completion). */
export async function completeLifecycleWorkflow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    message?: string
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run) return

  const prefix = run.template_id
  await advanceRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "completed",
    status: "completed",
    eventStep: "completed",
    message: params.message ?? "Lifecycle workflow completed.",
    graphEventType: `${prefix}.${LIFECYCLE_GRAPH_EVENTS.completed}`,
  })
}

/**
 * Advance move-out to inspection_scheduled and spawn a child inspection run.
 */
export async function scheduleMoveOutInspection(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    moveOutRunId: string
    scheduledAt?: string | null
  },
): Promise<{ inspectionRunId: string | null }> {
  const run = await getWorkflowRunById(supabase, params.moveOutRunId)
  if (!run || run.template_id !== "move_out") {
    return { inspectionRunId: null }
  }

  const { startInspectionWorkflow } = await import("./startLifecycleWorkflows.ts")
  const scheduledAt = params.scheduledAt ?? new Date().toISOString()

  await advanceRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "inspection_scheduled",
    eventStep: "schedule_move_out_inspection",
    message: "Move-out inspection scheduled.",
    graphEventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.inspectionScheduled}`,
  })

  if (!run.unit_id) return { inspectionRunId: null }

  const started = await startInspectionWorkflow(supabase, {
    landlordId: params.landlordId,
    unitId: run.unit_id,
    residentId: run.resident_id,
    propertyId: run.property_id,
    unitLabel: typeof run.metadata?.unit_label === "string"
      ? run.metadata.unit_label
      : null,
    building: typeof run.metadata?.building === "string"
      ? run.metadata.building
      : null,
    scheduledAt,
    inspectionType: "move_out",
    triggerType: "automation",
  })

  return { inspectionRunId: started.workflow_run_id }
}

/**
 * Spawn a move-in inspection for an active move-in run (auto-forward).
 */
export async function scheduleMoveInInspection(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    moveInRunId: string
    scheduledAt?: string | null
  },
): Promise<{ inspectionRunId: string | null }> {
  const run = await getWorkflowRunById(supabase, params.moveInRunId)
  if (!run || run.template_id !== "move_in" || !run.unit_id) {
    return { inspectionRunId: null }
  }

  const { startInspectionWorkflow } = await import("./startLifecycleWorkflows.ts")
  const scheduledAt = params.scheduledAt ?? new Date().toISOString()

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "act",
    step: "schedule_move_in_inspection",
    message: "Move-in inspection scheduled automatically.",
  })

  const started = await startInspectionWorkflow(supabase, {
    landlordId: params.landlordId,
    unitId: run.unit_id,
    residentId: run.resident_id,
    propertyId: run.property_id,
    unitLabel: typeof run.metadata?.unit_label === "string"
      ? run.metadata.unit_label
      : null,
    building: typeof run.metadata?.building === "string"
      ? run.metadata.building
      : null,
    scheduledAt,
    inspectionType: "move_in",
    triggerType: "automation",
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: `move_in.${LIFECYCLE_GRAPH_EVENTS.inspectionScheduled}`,
    source: "automation",
    actor_type: "system",
    resident_id: run.resident_id,
    unit_id: run.unit_id,
    property_id: run.property_id,
    workflow_run_id: run.id,
    workflow_template_id: "move_in",
    metadata: {
      message: "Move-in inspection scheduled",
      inspection_run_id: started.workflow_run_id,
    },
  })

  return { inspectionRunId: started.workflow_run_id }
}
