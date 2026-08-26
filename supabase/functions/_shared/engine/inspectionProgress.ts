/**
 * Inspection workflow progress — record, notice, outcome, follow-up, completion.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { loadLandlordDisplayName } from "../landlordDisplayName.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import {
  buildInspectionStartGuideSms,
  checklistToMetadata,
  initInspectionChecklist,
  normalizeInspectionOutcome,
  parseInspectionResidentReply,
  patchInspectionChecklist,
  readInspectionChecklist,
  type InspectionChecklistState,
  type InspectionOutcome,
} from "./inspectionChecklist.ts"
import {
  buildInspectionNoticeSms,
  buildInspectionReminderSms,
  readLifecycleStepState,
  type LifecycleStep,
} from "./lifecyclePolicy.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import { patchMoveOutChecklist, readMoveOutChecklist } from "./moveOutChecklist.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  logWorkflowEvent,
  updateWorkflowRun,
  type WorkflowRunRow,
} from "./workflowRuns.ts"
import type { InspectionType } from "./startWorkflow.ts"

type ResidentContact = {
  id: string
  full_name: string | null
  phone: string | null
}

function firstName(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim() || ""
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] || "there"
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

async function loadResident(
  supabase: SupabaseClient,
  residentId: string | null | undefined,
): Promise<ResidentContact | null> {
  if (!residentId) return null
  const { data } = await supabase
    .from("users")
    .select("id, full_name, phone")
    .eq("id", residentId)
    .maybeSingle()
  return (data as ResidentContact | null) ?? null
}

async function sendInspectionThreadSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    phone: string
    body: string
    runId: string
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
    templateId: "inspection",
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

async function persistInspectionRun(
  supabase: SupabaseClient,
  params: {
    run: WorkflowRunRow
    landlordId: string
    step: LifecycleStep
    eventStep: string
    message: string
    eventType?: string
    status?: "active" | "completed" | "cancelled" | "escalated"
    checklist?: InspectionChecklistState
    patch?: Record<string, unknown>
    extraMetadata?: Record<string, unknown>
  },
): Promise<WorkflowRunRow | null> {
  const now = new Date().toISOString()
  const prevState = readLifecycleStepState(params.run)
  const prevMeta = params.run.metadata ?? {}

  await logPipelineStageEvent(supabase, {
    runId: params.run.id,
    stage: "act",
    step: params.eventStep,
    message: params.message,
    metadata: { step: params.step },
  })

  const metadata: Record<string, unknown> = {
    ...prevMeta,
    ...(params.extraMetadata ?? {}),
    step_state: {
      ...prevState,
      step: params.step,
      ...(params.patch ?? {}),
      last_activity_at: now,
    },
  }
  if (params.checklist) {
    metadata.checklist = checklistToMetadata(params.checklist)
  }

  await updateWorkflowRun(supabase, params.run.id, {
    status: params.status ?? "active",
    currentStep: params.step,
    completedAt: params.status === "completed" ? now : null,
    metadata,
  })

  if (params.eventType) {
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: params.eventType,
      source: "automation",
      actorType: "system",
      residentId: params.run.resident_id,
      unitId: params.run.unit_id,
      propertyId: params.run.property_id,
      inspectionId: readString(prevMeta.inspection_id) ??
        readString(prevState.inspection_id),
      workflowRunId: params.run.id,
      workflowTemplateId: "inspection",
      metadata: { message: params.message, step: params.step },
    })
  }

  return await getWorkflowRunById(supabase, params.run.id)
}

async function updateUnitInspectionRow(
  supabase: SupabaseClient,
  params: {
    inspectionId: string
    status?: string
    noticeSentAt?: string | null
    completedAt?: string | null
    workflowRunId?: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (params.status) payload.status = params.status
  if (params.noticeSentAt) payload.notice_sent_at = params.noticeSentAt
  if (params.completedAt) payload.completed_at = params.completedAt
  if (params.workflowRunId) payload.workflow_run_id = params.workflowRunId
  if (params.metadata) payload.metadata = params.metadata

  await supabase
    .from("unit_inspections")
    .update(payload)
    .eq("id", params.inspectionId)
}

/** Create unit_inspections row and link to workflow run if missing. */
export async function ensureUnitInspectionRecord(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
  },
): Promise<string | null> {
  const meta = params.run.metadata ?? {}
  const existingId = readString(meta.inspection_id) ??
    readString(readLifecycleStepState(params.run).inspection_id)
  if (existingId) return existingId

  const state = readLifecycleStepState(params.run)
  const inspectionType = (readString(meta.inspection_type) ??
    readString(state.inspection_type) ??
    "periodic") as InspectionType
  const scheduledAt = readString(meta.scheduled_at) ??
    readString(state.scheduled_at)

  const { data, error } = await supabase
    .from("unit_inspections")
    .insert({
      landlord_id: params.landlordId,
      inspection_type: inspectionType,
      status: "scheduled",
      workflow_run_id: params.run.id,
      property_id: params.run.property_id,
      unit_id: params.run.unit_id,
      resident_id: params.run.resident_id,
      scheduled_at: scheduledAt,
      metadata: {
        unit_label: readString(meta.unit_label),
        building: readString(meta.building),
        parent_workflow_run_id: readString(meta.parent_workflow_run_id),
      },
    })
    .select("id")
    .single()

  if (error || !data?.id) {
    console.error("[inspection] create unit_inspections failed", error?.message)
    return null
  }

  const inspectionId = String(data.id)
  await updateWorkflowRun(supabase, params.run.id, {
    entityType: "inspection",
    entityId: inspectionId,
    metadata: {
      ...meta,
      inspection_id: inspectionId,
      step_state: {
        ...state,
        inspection_id: inspectionId,
      },
    },
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: `inspection.${LIFECYCLE_GRAPH_EVENTS.inspectionScheduled}`,
    source: "automation",
    actorType: "system",
    residentId: params.run.resident_id,
    unitId: params.run.unit_id,
    propertyId: params.run.property_id,
    inspectionId,
    workflowRunId: params.run.id,
    workflowTemplateId: "inspection",
    metadata: { message: "Inspection record created.", inspection_type: inspectionType },
  })

  return inspectionId
}

/** Send inspection notice; advance to awaiting_resident. */
export async function executeInspectionOutreach(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
  },
): Promise<{ ok: boolean; step: string; outreachSent: boolean; inspectionId: string | null }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "inspection" || run.status !== "active") {
    return { ok: false, step: "missing", outreachSent: false, inspectionId: null }
  }

  const state = readLifecycleStepState(run)
  const step = state.step ?? "scheduled"
  if (
    step !== "initiated" &&
    step !== "scheduled" &&
    step !== "notice_sent"
  ) {
    return {
      ok: true,
      step,
      outreachSent: false,
      inspectionId: readString(run.metadata?.inspection_id),
    }
  }

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "classify",
    step: "classify_inspection",
    message: "Classified inspection workflow.",
  })

  const inspectionId = await ensureUnitInspectionRecord(supabase, {
    landlordId: params.landlordId,
    run,
  })

  const freshRun = await getWorkflowRunById(supabase, params.runId)
  if (!freshRun) {
    return { ok: false, step: "missing", outreachSent: false, inspectionId }
  }

  const resident = await loadResident(supabase, freshRun.resident_id)
  const companyName = await loadLandlordDisplayName(supabase, params.landlordId)
  const scheduledAt = state.scheduled_at ??
    readString(freshRun.metadata?.scheduled_at)
  const inspectionType = state.inspection_type ??
    readString(freshRun.metadata?.inspection_type)

  let outreachSent = step === "notice_sent"
  let conversationId = state.conversation_id ??
    readString(freshRun.metadata?.conversation_id)

  const phone = resident?.phone?.trim()
  if (
    (step === "initiated" || step === "scheduled") &&
    resident &&
    phone
  ) {
    const body = buildInspectionNoticeSms({
      residentName: firstName(resident.full_name),
      companyName,
      scheduledAt,
      inspectionType,
    })
    const sent = await sendInspectionThreadSms(supabase, {
      landlordId: params.landlordId,
      residentId: resident.id,
      phone,
      body,
      runId: freshRun.id,
      source: "workflow_inspection_notice",
    })
    outreachSent = sent.ok
    conversationId = sent.conversationId
  }

  const now = new Date().toISOString()
  const checklist = patchInspectionChecklist(initInspectionChecklist(true), {
    notice_sent: outreachSent,
  })

  const nextStep: LifecycleStep = outreachSent ? "awaiting_resident" : "notice_sent"
  await persistInspectionRun(supabase, {
    run: freshRun,
    landlordId: params.landlordId,
    step: nextStep,
    eventStep: "send_inspection_notice",
    message: outreachSent
      ? "Inspection notice sent to the resident."
      : "Inspection scheduled (no resident phone on file).",
    eventType: `inspection.${LIFECYCLE_GRAPH_EVENTS.noticeSent}`,
    checklist,
    patch: {
      conversation_id: conversationId,
      scheduled_at: scheduledAt,
      inspection_type: inspectionType,
      inspection_id: inspectionId,
      reminder_count: 0,
    },
    extraMetadata: {
      conversation_id: conversationId,
      inspection_id: inspectionId,
    },
  })

  if (inspectionId && outreachSent) {
    await updateUnitInspectionRow(supabase, {
      inspectionId,
      status: "notice_sent",
      noticeSentAt: now,
      workflowRunId: freshRun.id,
    })
  }

  return { ok: true, step: nextStep, outreachSent, inspectionId }
}

async function createInspectionFollowUpTasks(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    run: WorkflowRunRow
    inspectionId: string | null
    outcome: InspectionOutcome
    notes?: string | null
  },
): Promise<number> {
  if (params.outcome !== "failed" && params.outcome !== "partial") {
    return 0
  }

  const title = params.outcome === "failed"
    ? "Inspection follow-up — issues require attention"
    : "Inspection follow-up — partial items to address"

  const { error } = await supabase.from("operations_tasks").insert({
    landlord_id: params.landlordId,
    task_type: "inspection_follow_up",
    status: "open",
    workflow_run_id: params.run.id,
    property_id: params.run.property_id,
    unit_id: params.run.unit_id,
    resident_id: params.run.resident_id,
    inspection_id: params.inspectionId,
    title,
    metadata: {
      outcome: params.outcome,
      notes: params.notes ?? null,
      source: "inspection_workflow",
    },
  })

  if (error) {
    console.error("[inspection] follow-up task insert failed", error.message)
    return 0
  }
  return 1
}

async function advanceParentMoveOutOnInspectionComplete(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    inspectionRun: WorkflowRunRow
  },
): Promise<void> {
  const meta = params.inspectionRun.metadata ?? {}
  const inspectionType = readString(meta.inspection_type) ??
    readString(readLifecycleStepState(params.inspectionRun).inspection_type)
  if (inspectionType !== "move_out") return

  const parentRunId = readString(meta.parent_workflow_run_id)
  if (!parentRunId) return

  const parent = await getWorkflowRunById(supabase, parentRunId)
  if (!parent || parent.template_id !== "move_out" || parent.status !== "active") {
    return
  }

  const checklist = patchMoveOutChecklist(readMoveOutChecklist(parent.metadata ?? {}), {
    inspection_completed: true,
  })

  const now = new Date().toISOString()
  const prevMeta = parent.metadata ?? {}
  const milestones = prevMeta.milestones && typeof prevMeta.milestones === "object"
    ? { ...(prevMeta.milestones as Record<string, unknown>) }
    : {}

  await updateWorkflowRun(supabase, parentRunId, {
    currentStep: "turnover_in_progress",
    metadata: {
      ...prevMeta,
      checklist: checklistToMetadata(checklist),
      milestones: { ...milestones, inspection_completed: now },
      step_state: {
        ...readLifecycleStepState(parent),
        step: "turnover_in_progress",
        last_activity_at: now,
      },
    },
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "move_out.inspection_completed",
    source: "automation",
    actorType: "system",
    residentId: parent.resident_id,
    unitId: parent.unit_id,
    workflowRunId: parentRunId,
    workflowTemplateId: "move_out",
    metadata: { message: "Move-out inspection completed.", child_run_id: params.inspectionRun.id },
  })
}

/** Record inspection outcome and optional follow-up tasks. */
export async function recordInspectionOutcome(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    outcome: InspectionOutcome
    notes?: string | null
    completeWorkflow?: boolean
  },
): Promise<{ ok: boolean; followUpCount: number }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "inspection") {
    return { ok: false, followUpCount: 0 }
  }

  const inspectionId = await ensureUnitInspectionRecord(supabase, {
    landlordId: params.landlordId,
    run,
  })

  let step: LifecycleStep = "in_progress"
  if (params.outcome === "no_show") step = "no_show"
  if (params.outcome === "rescheduled") step = "rescheduled"
  if (
    params.outcome === "passed" ||
    params.outcome === "failed" ||
    params.outcome === "partial"
  ) {
    step = params.completeWorkflow === false ? "in_progress" : "completed"
  }

  let checklist = patchInspectionChecklist(readInspectionChecklist(run.metadata ?? {}), {
    outcome_recorded: true,
    inspection_started: true,
  })

  const followUpCount = await createInspectionFollowUpTasks(supabase, {
    landlordId: params.landlordId,
    run,
    inspectionId,
    outcome: params.outcome,
    notes: params.notes,
  })

  if (followUpCount > 0) {
    checklist = patchInspectionChecklist(checklist, { follow_up_created: true })
  }

  const now = new Date().toISOString()
  const status = step === "completed" ? "completed" : "active"

  await persistInspectionRun(supabase, {
    run,
    landlordId: params.landlordId,
    step,
    eventStep: "record_inspection_outcome",
    message: `Inspection outcome recorded: ${params.outcome.replace(/_/g, " ")}.`,
    eventType: `inspection.${params.outcome === "passed" || params.outcome === "partial" || params.outcome === "failed" ? LIFECYCLE_GRAPH_EVENTS.inspectionCompleted : "outcome_recorded"}`,
    status,
    checklist,
    extraMetadata: {
      inspection_outcome: params.outcome,
      outcome_notes: params.notes ?? null,
      maintenance_request_created: followUpCount > 0,
    },
  })

  if (inspectionId) {
    await updateUnitInspectionRow(supabase, {
      inspectionId,
      status: step === "completed" ? "completed" : "in_progress",
      completedAt: step === "completed" ? now : null,
      metadata: { outcome: params.outcome, notes: params.notes ?? null },
    })
  }

  if (step === "completed") {
    await advanceParentMoveOutOnInspectionComplete(supabase, {
      landlordId: params.landlordId,
      inspectionRun: run,
    })
  }

  return { ok: true, followUpCount }
}

/** Process resident SMS on the inspection thread. */
export async function processInspectionResidentReply(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    body: string
  },
): Promise<{ step: string; replyHint: string; completed?: boolean }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "inspection") {
    return {
      step: "unknown",
      replyHint: "Thanks — reply here if you need help with your inspection.",
    }
  }

  const state = readLifecycleStepState(run)
  if (state.step === "completed") {
    return {
      step: "completed",
      replyHint: "Thanks — this inspection is complete.",
      completed: true,
    }
  }

  const intent = parseInspectionResidentReply(params.body)
  const resident = await loadResident(supabase, run.resident_id)
  const unitLabel = readString(run.metadata?.unit_label)

  if (intent === "start") {
    const checklist = patchInspectionChecklist(readInspectionChecklist(run.metadata ?? {}), {
      access_confirmed: true,
      inspection_started: true,
    })
    await persistInspectionRun(supabase, {
      run,
      landlordId: params.landlordId,
      step: "in_progress",
      eventStep: "start_inspection",
      message: "Resident started the guided inspection.",
      eventType: "inspection.started",
      checklist,
    })

    const guide = buildInspectionStartGuideSms({
      residentName: firstName(resident?.full_name),
      unitLabel,
    })
    return { step: "in_progress", replyHint: guide }
  }

  if (intent === "reschedule") {
    await persistInspectionRun(supabase, {
      run,
      landlordId: params.landlordId,
      step: "rescheduled",
      eventStep: "reschedule_inspection",
      message: "Resident requested to reschedule the inspection.",
      eventType: "inspection.rescheduled",
    })
    return {
      step: "rescheduled",
      replyHint:
        "Thanks — we've noted your request to reschedule. Your property manager will follow up with a new time.",
    }
  }

  if (intent === "complete") {
    const result = await recordInspectionOutcome(supabase, {
      landlordId: params.landlordId,
      runId: params.runId,
      outcome: "passed",
      notes: params.body.trim() || null,
      completeWorkflow: true,
    })
    return {
      step: "completed",
      replyHint: result.followUpCount > 0
        ? "Thank you — we've recorded your inspection and opened follow-up items for the property team."
        : "Thank you — your inspection is complete. We'll follow up if anything else is needed.",
      completed: true,
    }
  }

  return {
    step: state.step ?? "awaiting_resident",
    replyHint:
      "Thanks — please make sure we can access the unit for the inspection. Reply READY when you're ready, or let us know if you need to reschedule.",
  }
}

export async function completeInspectionWorkflow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    message?: string
  },
): Promise<void> {
  await recordInspectionOutcome(supabase, {
    landlordId: params.landlordId,
    runId: params.runId,
    outcome: "passed",
    completeWorkflow: true,
  })
}

export async function cancelInspectionWorkflow(
  supabase: SupabaseClient,
  params: { landlordId: string; runId: string },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "inspection") return

  await persistInspectionRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "cancelled",
    eventStep: "cancelled",
    message: "Inspection workflow cancelled.",
    eventType: `inspection.${LIFECYCLE_GRAPH_EVENTS.cancelled}`,
    status: "cancelled",
  })

  const inspectionId = readString(run.metadata?.inspection_id)
  if (inspectionId) {
    await updateUnitInspectionRow(supabase, {
      inspectionId,
      status: "cancelled",
    })
  }
}

export type InspectionAdminEngineAction =
  | "send_reminder"
  | "mark_no_show"
  | "record_outcome"
  | "complete_inspection"
  | "cancel_inspection"

export async function executeInspectionAdminAction(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    action: InspectionAdminEngineAction
    outcome?: string | null
    notes?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "inspection") {
    return { ok: false, error: "Inspection workflow not found." }
  }

  switch (params.action) {
    case "send_reminder": {
      const resident = await loadResident(supabase, run.resident_id)
      const phone = resident?.phone?.trim()
      if (resident && phone) {
        const companyName = await loadLandlordDisplayName(supabase, params.landlordId)
        const state = readLifecycleStepState(run)
        const body = buildInspectionReminderSms({
          residentName: firstName(resident.full_name),
          companyName,
          scheduledAt: state.scheduled_at ??
            readString(run.metadata?.scheduled_at),
        })
        await sendInspectionThreadSms(supabase, {
          landlordId: params.landlordId,
          residentId: resident.id,
          phone,
          body,
          runId: params.runId,
          source: "workflow_inspection_reminder",
        })
      }
      await recordActivityLog(supabase, {
        landlordId: params.landlordId,
        eventType: "inspection.reminder_sent",
        source: "dashboard",
        actorType: "landlord",
        residentId: run.resident_id,
        unitId: run.unit_id,
        workflowRunId: params.runId,
        workflowTemplateId: "inspection",
        metadata: { message: "Inspection reminder sent by admin." },
      })
      await logWorkflowEvent(supabase, {
        workflowRunId: params.runId,
        eventType: "inspection.reminder_sent",
        step: run.current_step ?? "awaiting_resident",
        actorType: "landlord",
        message: "Inspection reminder sent by admin",
      })
      return { ok: true }
    }
    case "mark_no_show":
      await recordInspectionOutcome(supabase, {
        landlordId: params.landlordId,
        runId: params.runId,
        outcome: "no_show",
        notes: params.notes,
        completeWorkflow: false,
      })
      return { ok: true }
    case "record_outcome": {
      const outcome = normalizeInspectionOutcome(params.outcome)
      if (!outcome) {
        return { ok: false, error: "Invalid inspection outcome." }
      }
      await recordInspectionOutcome(supabase, {
        landlordId: params.landlordId,
        runId: params.runId,
        outcome,
        notes: params.notes,
        completeWorkflow: outcome === "passed" || outcome === "failed" || outcome === "partial",
      })
      return { ok: true }
    }
    case "complete_inspection":
      await completeInspectionWorkflow(supabase, {
        landlordId: params.landlordId,
        runId: params.runId,
      })
      return { ok: true }
    case "cancel_inspection":
      await cancelInspectionWorkflow(supabase, params)
      return { ok: true }
    default:
      return { ok: false, error: "Unknown action." }
  }
}

/** Mark missed inspection window (cron / escalation). */
export async function executeInspectionMissedWindow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
  },
): Promise<{ ok: boolean; step: string }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "inspection") {
    return { ok: false, step: "missing" }
  }

  const state = readLifecycleStepState(run)
  const scheduledAt = state.scheduled_at ?? readString(run.metadata?.scheduled_at)
  if (!scheduledAt) {
    return { ok: true, step: state.step ?? "awaiting_resident" }
  }

  const scheduledMs = new Date(scheduledAt).getTime()
  if (Number.isNaN(scheduledMs) || scheduledMs > Date.now()) {
    return { ok: true, step: state.step ?? "awaiting_resident" }
  }

  if (state.step === "completed" || state.step === "no_show" || state.step === "cancelled") {
    return { ok: true, step: state.step }
  }

  await recordInspectionOutcome(supabase, {
    landlordId: params.landlordId,
    runId: params.runId,
    outcome: "no_show",
    completeWorkflow: false,
  })

  await persistInspectionRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "escalated",
    eventStep: "missed_inspection_window",
    message: "Inspection window passed without completion — escalated.",
    eventType: `inspection.${LIFECYCLE_GRAPH_EVENTS.escalated}`,
    status: "escalated",
    patch: {
      escalation_reason: "missed_inspection_window",
      escalated_at: new Date().toISOString(),
    },
  })

  return { ok: true, step: "escalated" }
}

export async function executeInspectionRegisterAndOutreach(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
  },
): Promise<{ ok: boolean; inspectionId: string | null; outreachSent: boolean }> {
  const outreach = await executeInspectionOutreach(supabase, params)
  return {
    ok: outreach.ok,
    inspectionId: outreach.inspectionId,
    outreachSent: outreach.outreachSent,
  }
}
