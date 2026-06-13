import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getEstimatedMinutes } from "../sla_rules.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { updateWorkflowRun } from "../engine/workflowRuns.ts"
import { startMaintenanceRequestWorkflow } from "../engine/startMaintenanceRequestWorkflow.ts"
import { assignVendorAndNotify } from "../../submit-maintenance-request/vendor_notify.ts"
import { notifyResidentSubmitted } from "../../submit-maintenance-request/resident_notify.ts"
import type { IssueType, SmsIntakeState } from "./residentIntakeTypes.ts"
import {
  buildIntakeDescription,
  issueTypeToCategory,
  severityToDb,
} from "./residentIntakeTypes.ts"

type ResidentRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  unit: string | null
}

function notificationChannelFromPreference(
  pref: string | undefined,
): "email" | "sms" | "both" {
  const p = (pref ?? "").trim().toLowerCase()
  if (p === "email") return "email"
  if (p === "text" || p === "sms") return "sms"
  return "both"
}

export async function submitSmsMaintenanceRequest(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    residentId: string
    intake: SmsIntakeState
  },
): Promise<{ ticketId: string }> {
  const { data: resident, error: residentErr } = await supabase
    .from("users")
    .select("id, full_name, email, phone, unit")
    .eq("id", params.residentId)
    .maybeSingle()

  if (residentErr || !resident) {
    console.error("[sms-intake] resident lookup failed", residentErr?.message)
    throw new Error("Could not load resident for maintenance request")
  }

  const row = resident as ResidentRow
  const unit = row.unit?.trim()
  if (!unit) {
    throw new Error("Resident has no unit assigned")
  }

  const priority = params.intake.urgency?.trim() || "normal"
  const issueCategory = issueTypeToCategory(params.intake.issue_type as IssueType)
  const dbSeverity = severityToDb(params.intake.severity)
  const estimatedMinutes = getEstimatedMinutes(issueCategory, dbSeverity)
  const dueAt = new Date(Date.now() + estimatedMinutes * 60_000)
  const description = buildIntakeDescription(params.intake)
  const notificationChannel = notificationChannelFromPreference(
    params.intake.preferred_contact_method,
  )

  const { data: ticket, error: insertErr } = await supabase
    .from("maintenance_requests")
    .insert({
      priority,
      urgency: priority,
      resident_name: row.full_name?.trim() || "Resident",
      email: row.email?.trim() || `${params.residentId}@sms-resident.ulohome.local`,
      resident_phone: row.phone,
      resident_notification_channel: notificationChannel,
      unit,
      description,
      resident_user_id: null,
      photo_paths: [],
      issue_category: issueCategory,
      severity: dbSeverity,
      estimated_minutes: estimatedMinutes,
      due_at: dueAt.toISOString(),
      vendor_work_status: "unassigned",
    })
    .select("id")
    .single()

  if (insertErr || !ticket?.id) {
    console.error("[sms-intake] maintenance_requests insert", insertErr?.message)
    throw new Error("Failed to create maintenance request")
  }

  const ticketId = ticket.id as string

  await supabase
    .from("sms_conversations")
    .update({
      maintenance_request_id: ticketId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)

  const { data: conversation } = await supabase
    .from("sms_conversations")
    .select("workflow_run_id")
    .eq("id", params.conversationId)
    .maybeSingle()

  const intakeRunId = conversation?.workflow_run_id ?? null

  if (intakeRunId) {
    await updateWorkflowRun(supabase, intakeRunId, {
      status: "completed",
      currentStep: "submitted",
      entityType: "maintenance_request",
      entityId: ticketId,
      completedAt: new Date().toISOString(),
      metadata: {
        intake_state: params.intake as Record<string, unknown>,
        submitted_at: new Date().toISOString(),
      },
      pipelineStage: "act",
      eventMessage: "Ticket created from SMS intake",
      eventStep: "submitted",
    })
  }

  let maintenanceWorkflowRunId: string | null = null
  try {
    const started = await startMaintenanceRequestWorkflow(supabase, {
      landlordId: params.landlordId,
      ticketId,
      residentId: params.residentId,
      triggerType: "sms_inbound",
      dueAt: dueAt.toISOString(),
      issueCategory,
      severity: dbSeverity,
      unitLabel: unit,
      source: "sms_intake",
      intakeRunId,
      conversationId: params.conversationId,
    })
    maintenanceWorkflowRunId = started.workflowRunId
  } catch (e) {
    console.error("[sms-intake] maintenance_request workflow", e)
  }

  const descPrev =
    description.length > 200 ? `${description.slice(0, 197)}…` : description

  try {
    await notifyResidentSubmitted(supabase, {
      ticketId,
      recipientName: row.full_name?.trim() || "Resident",
      recipientEmail: row.email,
      recipientPhone: row.phone,
      notificationChannel,
      unit,
      priority,
      descriptionPreview: descPrev,
    })
  } catch (e) {
    console.error("[sms-intake] resident notify failed", e)
  }

  try {
    await assignVendorAndNotify(supabase, {
      ticketId,
      priority,
      unit,
      description,
      dueAt: dueAt.toISOString(),
      estimatedMinutes,
    })
  } catch (e) {
    console.error("[sms-intake] vendor notify failed", e)
  }

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "maintenance.request_submitted",
    source: "sms",
    actor_type: "resident",
    actor_id: params.residentId,
    resident_id: params.residentId,
    maintenance_request_id: ticketId,
    conversation_id: params.conversationId,
    workflow_run_id: maintenanceWorkflowRunId ?? intakeRunId,
    workflow_template_id: maintenanceWorkflowRunId
      ? "maintenance_request"
      : "maintenance_intake",
    metadata: {
      unit,
      priority,
      issue_category: issueCategory,
      severity: dbSeverity,
      issue_type: params.intake.issue_type,
      room_or_area: params.intake.room_or_area,
      preferred_contact_method: params.intake.preferred_contact_method,
      source: "sms_intake",
    },
  })

  console.info("[sms-intake] maintenance request submitted", {
    ticketId,
    conversationId: params.conversationId,
    residentId: params.residentId,
    unit,
    priority,
    issueCategory,
  })

  return { ticketId }
}
