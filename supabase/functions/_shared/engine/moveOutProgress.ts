/**
 * Move-out workflow progress — outreach, vacancy, inspection, completion.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import { sendMoveOutOutreach } from "../move_out_outreach.ts"
import { markUnitVacant } from "../unitVacancy.ts"
import {
  buildMoveOutDateConfirmPrompt,
  checklistToMetadata,
  initMoveOutChecklist,
  parseMoveOutResidentReply,
  patchMoveOutChecklist,
  readMoveOutChecklist,
  type MoveOutChecklistState,
} from "./moveOutChecklist.ts"
import { readLifecycleStepState, type LifecycleStep } from "./lifecyclePolicy.ts"
import { LIFECYCLE_GRAPH_EVENTS } from "./lifecycleWorkflowTemplates.ts"
import { startInspectionWorkflow } from "./startWorkflow.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  logWorkflowEvent,
  updateWorkflowRun,
  type WorkflowRunRow,
} from "./workflowRuns.ts"

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

async function sendMoveOutThreadSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    phone: string
    body: string
    runId: string
    source: string
  },
): Promise<boolean> {
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line) return false

  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone: params.phone,
    identityType: "resident",
    residentId: params.residentId,
  })
  if (!identity) return false

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
    templateId: "move_out",
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
  return sent.ok
}

async function persistMoveOutRun(
  supabase: SupabaseClient,
  params: {
    run: WorkflowRunRow
    landlordId: string
    step: LifecycleStep
    eventStep: string
    message: string
    eventType?: string
    status?: "active" | "completed" | "cancelled"
    checklist?: MoveOutChecklistState
    milestones?: Record<string, unknown>
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

  const prevMilestones = prevMeta.milestones && typeof prevMeta.milestones === "object"
    ? { ...(prevMeta.milestones as Record<string, unknown>) }
    : {}

  const metadata: Record<string, unknown> = {
    ...prevMeta,
    ...(params.extraMetadata ?? {}),
    step_state: {
      ...prevState,
      step: params.step,
      last_activity_at: now,
    },
    milestones: {
      ...prevMilestones,
      ...(params.milestones ?? {}),
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
      workflowRunId: params.run.id,
      workflowTemplateId: "move_out",
      metadata: { message: params.message, step: params.step },
    })
  }

  return await getWorkflowRunById(supabase, params.run.id)
}

/** Send move-out welcome + instructions; advance to awaiting_vacate. */
export async function executeMoveOutOutreach(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    sourceWorkflowRunId?: string | null
  },
): Promise<{ ok: boolean; step: string; outreachSent: boolean }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_out" || run.status !== "active") {
    return { ok: false, step: "missing", outreachSent: false }
  }

  const state = readLifecycleStepState(run)
  const step = state.step ?? "initiated"
  if (step !== "initiated" && step !== "notice_sent") {
    return { ok: true, step, outreachSent: false }
  }

  await logPipelineStageEvent(supabase, {
    runId: run.id,
    stage: "classify",
    step: "classify_move_out",
    message: "Classified move-out workflow.",
  })

  const resident = await loadResident(supabase, run.resident_id)
  const moveOutDate = state.move_out_date ??
    (typeof run.metadata?.move_out_date === "string" ? run.metadata.move_out_date : null)

  let outreachSent = step === "notice_sent"
  let conversationId: string | null = state.conversation_id ??
    (typeof run.metadata?.conversation_id === "string" ? run.metadata.conversation_id : null)

  const phone = resident?.phone?.trim()
  if (step === "initiated" && resident && phone) {
    const result = await sendMoveOutOutreach(supabase, {
      landlordId: params.landlordId,
      residentId: resident.id,
      residentPhone: phone,
      residentFirstName: firstName(resident.full_name),
      moveOutRunId: run.id,
      moveOutDate,
      unitId: run.unit_id,
      propertyId: run.property_id,
      sourceWorkflowRunId: params.sourceWorkflowRunId ?? null,
    })
    outreachSent = result.ok
    conversationId = result.conversationId

    const afterOutreach = await getWorkflowRunById(supabase, run.id)
    if (afterOutreach) {
      const advancedStep = readLifecycleStepState(afterOutreach).step ?? "initiated"
      if (advancedStep !== "initiated" && advancedStep !== "notice_sent") {
        return { ok: true, step: advancedStep, outreachSent }
      }
    }

    if (outreachSent && moveOutDate) {
      await sendMoveOutThreadSms(supabase, {
        landlordId: params.landlordId,
        residentId: resident.id,
        phone,
        body: buildMoveOutDateConfirmPrompt(moveOutDate),
        runId: run.id,
        source: "workflow_move_out_date_confirm",
      })
    }
  }

  const now = new Date().toISOString()
  const checklist = patchMoveOutChecklist(initMoveOutChecklist(true), {
    resident_notified: outreachSent,
    instructions_delivered: outreachSent,
  })

  await persistMoveOutRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "awaiting_vacate",
    eventStep: "send_move_out_instructions",
    message: outreachSent
      ? "Move-out instructions sent to the resident."
      : "Move-out workflow waiting (no resident phone on file).",
    eventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.noticeSent}`,
    checklist,
    milestones: {
      move_out_started: now,
      instructions_sent: outreachSent ? now : undefined,
    },
    extraMetadata: {
      conversation_id: conversationId,
    },
  })

  return { ok: true, step: "awaiting_vacate", outreachSent }
}

/** Mark unit vacant and advance the move-out run. */
export async function executeMoveOutMarkVacated(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    unitId?: string | null
    unitLabel?: string | null
    building?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_out") {
    return { ok: false, error: "Move-out workflow run not found." }
  }

  try {
    await markUnitVacant(supabase, {
      landlordId: params.landlordId,
      unitId: params.unitId ?? run.unit_id,
      unitLabel: params.unitLabel ?? undefined,
      building: params.building ?? undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }

  const checklist = patchMoveOutChecklist(readMoveOutChecklist(run.metadata ?? {}), {
    keys_returned: true,
  })

  await persistMoveOutRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "unit_vacated",
    eventStep: "mark_unit_vacant",
    message: "Unit marked vacant and occupancy ended.",
    eventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.unitVacated}`,
    checklist,
    milestones: { keys_returned: new Date().toISOString() },
  })

  return { ok: true }
}

/** Schedule move-out inspection and spawn child inspection workflow. */
export async function executeMoveOutScheduleInspection(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    scheduledAt?: string | null
  },
): Promise<{ inspectionRunId: string | null }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_out" || !run.unit_id) {
    return { inspectionRunId: null }
  }

  const scheduledAt = params.scheduledAt ?? new Date().toISOString()
  const checklist = patchMoveOutChecklist(readMoveOutChecklist(run.metadata ?? {}), {
    inspection_scheduled: true,
  })

  await persistMoveOutRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "inspection_scheduled",
    eventStep: "schedule_move_out_inspection",
    message: "Move-out inspection scheduled.",
    eventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.inspectionScheduled}`,
    checklist,
    milestones: { inspection_scheduled: scheduledAt },
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
    inspectionType: "move_out",
    triggerType: "automation",
    parentWorkflowRunId: params.runId,
  })

  return { inspectionRunId: started.workflow_run_id }
}

/** Process resident SMS on the move-out thread. */
export async function processMoveOutResidentReply(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    body: string
  },
): Promise<{ step: string; replyHint: string }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_out") {
    return {
      step: "unknown",
      replyHint: "Thanks — reply here if you need help with your move-out.",
    }
  }

  const state = readLifecycleStepState(run)
  if (state.step === "completed") {
    return {
      step: "completed",
      replyHint: "Your move-out is complete. Reply here anytime if you need help.",
    }
  }

  const intent = parseMoveOutResidentReply(params.body)
  let checklist = readMoveOutChecklist(run.metadata ?? {})
  const nextStep: LifecycleStep = (state.step ?? "awaiting_vacate") as LifecycleStep
  let replyHint =
    "Thanks — please finish your move-out steps (cleaning, keys, and inspection). Reply here if you have questions."

  if (intent === "confirm_date") {
    checklist = patchMoveOutChecklist(checklist, { move_out_date_confirmed: true })
    await persistMoveOutRun(supabase, {
      run,
      landlordId: params.landlordId,
      step: "awaiting_vacate",
      eventStep: "confirm_move_out_date",
      message: "Resident confirmed move-out date.",
      eventType: "move_out.date_confirmed",
      checklist,
    })
    return {
      step: "awaiting_vacate",
      replyHint:
        "Thank you — your move-out date is confirmed. We'll follow up about cleaning, keys, and the inspection as your date approaches.",
    }
  }

  if (intent === "vacated") {
    await executeMoveOutMarkVacated(supabase, {
      landlordId: params.landlordId,
      runId: params.runId,
    })
    await executeMoveOutScheduleInspection(supabase, {
      landlordId: params.landlordId,
      runId: params.runId,
    })
    return {
      step: "inspection_scheduled",
      replyHint:
        "Thank you — we've noted that you've moved out. We'll follow up about the final inspection and deposit review.",
    }
  }

  return { step: nextStep, replyHint }
}

export async function completeMoveOutWorkflow(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    message?: string
  },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_out") return

  const checklist = patchMoveOutChecklist(readMoveOutChecklist(run.metadata ?? {}), {
    inspection_completed: true,
    property_ready_for_turnover: true,
  })

  await persistMoveOutRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "completed",
    eventStep: "completed",
    message: params.message ?? "Move-out workflow completed.",
    eventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.completed}`,
    status: "completed",
    checklist,
    milestones: { move_out_complete: new Date().toISOString() },
  })
}

export async function cancelMoveOutWorkflow(
  supabase: SupabaseClient,
  params: { landlordId: string; runId: string },
): Promise<void> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_out") return

  await persistMoveOutRun(supabase, {
    run,
    landlordId: params.landlordId,
    step: "cancelled",
    eventStep: "cancelled",
    message: "Move-out workflow cancelled.",
    eventType: `move_out.${LIFECYCLE_GRAPH_EVENTS.cancelled}`,
    status: "cancelled",
  })
}

export type MoveOutAdminEngineAction =
  | "send_reminder"
  | "schedule_inspection"
  | "mark_keys_returned"
  | "complete_cleaning"
  | "complete_move_out"
  | "cancel_move_out"

/** Admin dashboard action → engine side effects. */
export async function executeMoveOutAdminAction(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    runId: string
    action: MoveOutAdminEngineAction
  },
): Promise<{ ok: boolean; error?: string; inspectionRunId?: string | null }> {
  const run = await getWorkflowRunById(supabase, params.runId)
  if (!run || run.template_id !== "move_out") {
    return { ok: false, error: "Move-out workflow not found." }
  }

  switch (params.action) {
    case "schedule_inspection": {
      const spawned = await executeMoveOutScheduleInspection(supabase, {
        landlordId: params.landlordId,
        runId: params.runId,
      })
      return { ok: true, inspectionRunId: spawned.inspectionRunId }
    }
    case "mark_keys_returned": {
      const checklist = patchMoveOutChecklist(readMoveOutChecklist(run.metadata ?? {}), {
        keys_returned: true,
      })
      await persistMoveOutRun(supabase, {
        run,
        landlordId: params.landlordId,
        step: "unit_vacated",
        eventStep: "mark_keys_returned",
        message: "Keys marked returned by admin.",
        eventType: "move_out.keys_returned",
        checklist,
        milestones: { keys_returned: new Date().toISOString() },
      })
      return { ok: true }
    }
    case "complete_cleaning": {
      const checklist = patchMoveOutChecklist(readMoveOutChecklist(run.metadata ?? {}), {
        cleaning_scheduled: true,
      })
      await persistMoveOutRun(supabase, {
        run,
        landlordId: params.landlordId,
        step: "turnover_in_progress",
        eventStep: "complete_cleaning",
        message: "Cleaning marked complete.",
        eventType: "move_out.cleaning_completed",
        checklist,
        milestones: { cleaning_scheduled: new Date().toISOString() },
      })
      return { ok: true }
    }
    case "complete_move_out":
      await completeMoveOutWorkflow(supabase, {
        landlordId: params.landlordId,
        runId: params.runId,
      })
      return { ok: true }
    case "cancel_move_out":
      await cancelMoveOutWorkflow(supabase, params)
      return { ok: true }
    case "send_reminder": {
      const resident = await loadResident(supabase, run.resident_id)
      const phone = resident?.phone?.trim()
      if (resident && phone) {
        const { buildMoveOutReminderSms } = await import("./lifecyclePolicy.ts")
        const { data: landlord } = await supabase
          .from("landlords")
          .select("name")
          .eq("id", params.landlordId)
          .maybeSingle()
        const companyName = typeof landlord?.name === "string" ? landlord.name : null
        const moveOutDate = readLifecycleStepState(run).move_out_date ??
          (typeof run.metadata?.move_out_date === "string" ? run.metadata.move_out_date : null)
        const body = buildMoveOutReminderSms({
          residentName: firstName(resident.full_name),
          companyName,
          moveOutDate,
        })
        await sendMoveOutThreadSms(supabase, {
          landlordId: params.landlordId,
          residentId: resident.id,
          phone,
          body,
          runId: params.runId,
          source: "workflow_move_out_reminder",
        })
      }
      await recordActivityLog(supabase, {
        landlordId: params.landlordId,
        eventType: "move_out.reminder_sent",
        source: "dashboard",
        actorType: "landlord",
        residentId: run.resident_id,
        unitId: run.unit_id,
        workflowRunId: params.runId,
        workflowTemplateId: "move_out",
        metadata: { message: "Move-out reminder sent by admin." },
      })
      await logWorkflowEvent(supabase, {
        workflowRunId: params.runId,
        eventType: "move_out.reminder_sent",
        step: run.current_step ?? "awaiting_vacate",
        actorType: "landlord",
        message: "Move-out reminder sent by admin",
      })
      return { ok: true }
    }
    default:
      return { ok: false, error: "Unknown action." }
  }
}

export async function findActiveMoveOutRunForUnit(
  supabase: SupabaseClient,
  params: { landlordId: string; unitId: string },
): Promise<string | null> {
  const { data } = await supabase
    .from("workflow_runs")
    .select("id")
    .eq("landlord_id", params.landlordId)
    .eq("template_id", "move_out")
    .eq("status", "active")
    .eq("unit_id", params.unitId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}
