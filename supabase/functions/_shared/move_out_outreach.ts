import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { sendInboundAutoReply } from "./sms/inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { resolveOutboundLandlordSmsLine } from "./sms/landlordSmsOnboarding.ts"
import {
  getWorkflowRunById,
  linkConversationToWorkflowRun,
  logWorkflowEvent,
  updateWorkflowRun,
} from "./engine/workflowRuns.ts"

function readRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * After lease-renewal "trigger move-out prep", auto-complete pipeline stages 1–3
 * (started, instructions, cleaning) and queue inspection as the active step.
 */
export async function applyLeaseRenewalMoveOutKickoff(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    moveOutRunId: string
    moveOutDate: string | null
    unitId: string | null
    propertyId: string | null
    conversationId: string | null
    sourceWorkflowRunId?: string | null
  },
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await getWorkflowRunById(supabase, params.moveOutRunId)
  if (!existing) return

  const baseMeta = readRecord(existing.metadata)
  const prevMilestones = readRecord(baseMeta.milestones)
  const prevChecklist = readRecord(baseMeta.checklist)
  const prevStepState = readRecord(baseMeta.step_state)

  const milestones = {
    ...prevMilestones,
    move_out_started: readString(prevMilestones.move_out_started) ?? now,
    instructions_sent: readString(prevMilestones.instructions_sent) ?? now,
    cleaning_scheduled: now,
  }

  const checklist = {
    ...prevChecklist,
    resident_notified: true,
    instructions_delivered: true,
    notice_received: true,
    cleaning_scheduled: true,
    inspection_scheduled: true,
  }

  await updateWorkflowRun(supabase, params.moveOutRunId, {
    currentStep: "inspection_scheduled",
    metadata: {
      conversation_id: params.conversationId ?? readString(baseMeta.conversation_id),
      move_out_date: params.moveOutDate ?? readString(baseMeta.move_out_date),
      milestones,
      checklist,
      kickoff_source: "lease_renewal_escalation",
      kickoff_completed_at: now,
      step_state: {
        ...prevStepState,
        step: "inspection_scheduled",
        move_out_date: params.moveOutDate ?? readString(prevStepState.move_out_date),
        conversation_id: params.conversationId ?? readString(prevStepState.conversation_id),
      },
    },
    pipelineStage: "act",
    eventMessage:
      "Automated move-out kickoff — resident notified, cleaning scheduled, inspection queued",
    eventStep: "inspection_scheduled",
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: params.moveOutRunId,
    eventType: "workflow.act",
    step: "cleaning_scheduled",
    actorType: "system",
    message: "Turnover cleaning auto-scheduled from lease renewal escalation",
    metadata: { source_workflow_run_id: params.sourceWorkflowRunId ?? null },
  })

  await logWorkflowEvent(supabase, {
    workflowRunId: params.moveOutRunId,
    eventType: "workflow.act",
    step: "inspection_scheduled",
    actorType: "system",
    message: "Move-out inspection queued after automated kickoff",
    metadata: { source_workflow_run_id: params.sourceWorkflowRunId ?? null },
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "move_out.cleaning_scheduled",
    source: "automation",
    actor_type: "system",
    resident_id: params.residentId,
    unit_id: params.unitId,
    property_id: params.propertyId,
    conversation_id: params.conversationId,
    workflow_run_id: params.moveOutRunId,
    workflow_template_id: "move_out",
    metadata: {
      source_workflow: "lease_renewal",
      source_workflow_run_id: params.sourceWorkflowRunId ?? null,
      message: "Cleaning auto-scheduled during lease renewal move-out kickoff",
    },
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "move_out.inspection_scheduled",
    source: "automation",
    actor_type: "system",
    resident_id: params.residentId,
    unit_id: params.unitId,
    property_id: params.propertyId,
    conversation_id: params.conversationId,
    workflow_run_id: params.moveOutRunId,
    workflow_template_id: "move_out",
    metadata: {
      source_workflow: "lease_renewal",
      source_workflow_run_id: params.sourceWorkflowRunId ?? null,
      message: "Move-out inspection queued during automated kickoff",
    },
  })
}

export function moveOutWelcomeMessage(
  residentFirstName: string,
  moveOutDateIso: string | null,
): string {
  const name = residentFirstName.trim() || "there"
  let datePart = " at the end of your lease"
  if (moveOutDateIso?.trim()) {
    const formatted = new Date(`${moveOutDateIso.trim().slice(0, 10)}T12:00:00`)
      .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    datePart = ` at the end of your lease on ${formatted}`
  }
  return (
    `Hi ${name}, this is your property management team. We understand you'll be ` +
    `moving out${datePart}. We'll use this conversation to guide you through the ` +
    "process, so you know what to expect and what to complete before your move-out date."
  )
}

export function moveOutInstructionsMessage(
  residentFirstName: string,
  moveOutDateIso: string | null,
): string {
  const name = residentFirstName.trim() || "there"
  const dateLine = moveOutDateIso?.trim()
    ? `Your move-out date is ${new Date(`${moveOutDateIso.trim().slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. `
    : ""
  return (
    `${dateLine}${name}, here are your move-out steps:\n` +
    "1. Give formal notice if required\n" +
    "2. Schedule cleaning\n" +
    "3. Return your keys on move-out day\n" +
    "4. Complete the move-out inspection\n\n" +
    "Reply here anytime with questions and we're happy to help."
  )
}

export type SendMoveOutOutreachResult = {
  ok: boolean
  conversationId: string | null
  messageId: string | null
  error?: string
}

/** Open resident SMS thread, link to move_out run, send welcome + instructions. */
export async function sendMoveOutOutreach(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    residentPhone: string
    residentFirstName: string
    moveOutRunId: string
    moveOutDate: string | null
    unitId: string | null
    propertyId: string | null
    sourceWorkflowRunId?: string | null
  },
): Promise<SendMoveOutOutreachResult> {
  const mainLine = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!mainLine) {
    return { ok: false, conversationId: null, messageId: null, error: "No active landlord SMS number" }
  }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone: params.residentPhone,
    landlordId: params.landlordId,
    identityType: "resident",
    residentId: params.residentId,
  })
  if (!identity) {
    return { ok: false, conversationId: null, messageId: null, error: "Could not resolve resident SMS identity" }
  }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: mainLine.id,
    externalPhone: params.residentPhone,
    identity,
    maintenanceRequestId: null,
    conversationStatus: "open",
  })

  await linkConversationToWorkflowRun(supabase, {
    conversationId,
    runId: params.moveOutRunId,
    templateId: "move_out",
  })

  const welcomeBody = moveOutWelcomeMessage(params.residentFirstName, params.moveOutDate)
  const welcomeSent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: mainLine.phone,
    toNumber: params.residentPhone,
    body: welcomeBody,
    provider: mainLine.provider,
    source: "workflow_move_out_outreach",
  })

  if (!welcomeSent.ok) {
    if (params.sourceWorkflowRunId) {
      await applyLeaseRenewalMoveOutKickoff(supabase, {
        landlordId: params.landlordId,
        residentId: params.residentId,
        moveOutRunId: params.moveOutRunId,
        moveOutDate: params.moveOutDate,
        unitId: params.unitId,
        propertyId: params.propertyId,
        conversationId,
        sourceWorkflowRunId: params.sourceWorkflowRunId,
      })
      console.warn(
        "[move-out-outreach] welcome SMS failed; lease-renewal kickoff still applied",
        welcomeSent.error,
      )
      return {
        ok: true,
        conversationId,
        messageId: null,
        error: welcomeSent.error ?? "SMS delivery failed; move-out kickoff still applied",
      }
    }
    return {
      ok: false,
      conversationId,
      messageId: null,
      error: welcomeSent.error ?? "Failed to send move-out welcome SMS",
    }
  }

  const instructionsBody = moveOutInstructionsMessage(params.residentFirstName, params.moveOutDate)
  const instructionsSent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: mainLine.phone,
    toNumber: params.residentPhone,
    body: instructionsBody,
    provider: mainLine.provider,
    source: "workflow_move_out_instructions",
  })

  const now = new Date().toISOString()
  const milestones = {
    move_out_started: now,
    resident_notified: now,
    instructions_sent: now,
  }
  const checklist = {
    resident_notified: true,
    instructions_delivered: true,
  }

  if (params.sourceWorkflowRunId) {
    await updateWorkflowRun(supabase, params.moveOutRunId, {
      currentStep: "notice_sent",
      metadata: {
        conversation_id: conversationId,
        milestones,
        checklist,
        step_state: {
          step: "notice_sent",
          move_out_date: params.moveOutDate,
          conversation_id: conversationId,
        },
      },
      pipelineStage: "route",
      eventMessage: "Move-out instructions sent to resident",
      eventStep: "notice_sent",
    })

    await applyLeaseRenewalMoveOutKickoff(supabase, {
      landlordId: params.landlordId,
      residentId: params.residentId,
      moveOutRunId: params.moveOutRunId,
      moveOutDate: params.moveOutDate,
      unitId: params.unitId,
      propertyId: params.propertyId,
      conversationId,
      sourceWorkflowRunId: params.sourceWorkflowRunId,
    })
  } else {
    await updateWorkflowRun(supabase, params.moveOutRunId, {
      currentStep: "notice_sent",
      metadata: {
        conversation_id: conversationId,
        milestones,
        checklist,
        step_state: {
          step: "notice_sent",
          move_out_date: params.moveOutDate,
          conversation_id: conversationId,
        },
      },
      pipelineStage: "route",
      eventMessage: "Move-out instructions sent to resident",
      eventStep: "notice_sent",
    })
  }

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "move_out.resident_notified",
    source: "dashboard",
    actor_type: "landlord",
    resident_id: params.residentId,
    unit_id: params.unitId,
    property_id: params.propertyId,
    conversation_id: conversationId,
    workflow_run_id: params.moveOutRunId,
    workflow_template_id: "move_out",
    metadata: {
      source_workflow: "lease_renewal",
      source_workflow_run_id: params.sourceWorkflowRunId ?? null,
      message: welcomeBody,
    },
  })

  if (instructionsSent.ok) {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "move_out.instructions_sent",
      source: "dashboard",
      actor_type: "landlord",
      resident_id: params.residentId,
      unit_id: params.unitId,
      property_id: params.propertyId,
      conversation_id: conversationId,
      workflow_run_id: params.moveOutRunId,
      workflow_template_id: "move_out",
      metadata: {
        source_workflow: "lease_renewal",
        source_workflow_run_id: params.sourceWorkflowRunId ?? null,
        message: instructionsBody,
      },
    })
  }

  return {
    ok: true,
    conversationId,
    messageId: welcomeSent.messageId ?? null,
  }
}
