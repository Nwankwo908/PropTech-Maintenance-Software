/**
 * Applies an admin Active Tasks stage move. Callers own auth + ownership checks.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { closeOpenAsksForTicket } from "../closeOpenAsksForTicket.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { updateWorkflowRun } from "../engine/workflowRuns.ts"
import { markMaintenanceJobCompleted } from "../maintenanceSpend.ts"
import { sendVendorJobAlert } from "../sms/vendorSmsRouting.ts"
import { formatWorkOrderRef, vendorCompanyName } from "../vendor_outreach_copy.ts"
import { notifyResidentCompleted } from "../../submit-maintenance-request/resident_notify.ts"
import { assignVendorAndNotify } from "../../submit-maintenance-request/vendor_notify.ts"
import { WORKFLOW_STAGE_LABEL, type WorkflowKanbanStageId } from "../../../../shared/workflowStageMove/stageMoveRules.ts"
import {
  deriveInspectionVisitKanbanStage,
  deriveTicketKanbanStage,
} from "./deriveTicketKanbanStage.ts"

export type ApplyAdminStageMoveInput = {
  landlordId: string
  runId: string
  /** Primary ticket (required for single-WO moves; also used as fallback for visits). */
  ticketId: string
  /**
   * When set, move every open fail-item under this inspection report (visit rollup).
   * `ticketIds` optionally scopes the set; server still verifies report membership.
   */
  inspectionReportId?: string | null
  ticketIds?: string[] | null
  fromStage: WorkflowKanbanStageId
  toStage: WorkflowKanbanStageId
  note?: string | null
  /** After → New Intake: re-run vendor assignment. */
  findVendorNow?: boolean
  /** Backward from Completed: text vendor + tenant. */
  notifyVendorAndTenant?: boolean
  actorId?: string | null
}

type TicketRow = {
  id: string
  landlord_id: string | null
  assigned_vendor_id: string | null
  vendor_work_status: string | null
  completed_at: string | null
  inspection_report_id?: string | null
}

function isTerminalStatus(status: string | null | undefined): boolean {
  const vws = (status ?? "").trim().toLowerCase()
  return vws === "completed" || vws === "cancelled"
}

export type ApplyAdminStageMoveResult =
  | {
      ok: true
      stage: WorkflowKanbanStageId
      vendorWorkStatus: string | null
      assignedVendorId: string | null
    }
  | { ok: false; status: number; error: string; currentStage?: WorkflowKanbanStageId }

function stageLabel(stage: WorkflowKanbanStageId): string {
  return WORKFLOW_STAGE_LABEL[stage] ?? stage
}

async function loadVendorName(
  supabase: SupabaseClient,
  vendorId: string | null | undefined,
): Promise<string> {
  const id = vendorId?.trim()
  if (!id) return "the vendor"
  const { data } = await supabase.from("vendors").select("name").eq("id", id).maybeSingle()
  const name = typeof data?.name === "string" ? data.name.trim() : ""
  return name ? vendorCompanyName(name) : "the vendor"
}

async function textVendorWithdrawn(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    landlordId: string
    vendorId: string
    vendorName: string
  },
): Promise<void> {
  const { data: vendor } = await supabase
    .from("vendors")
    .select("phone")
    .eq("id", params.vendorId)
    .maybeSingle()
  const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
  if (!phone) return
  const wo = formatWorkOrderRef(params.ticketId)
  const body = [
    `Hi ${params.vendorName},`,
    "",
    `Update for work order ${wo}.`,
    "",
    "The property team withdrew this job from your queue.",
    "You don't need to take any further action on it.",
  ].join("\n")
  await sendVendorJobAlert(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorPhone: phone,
    body,
    landlordId: params.landlordId,
  })
}

async function moveToNewIntake(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    previousVendorId: string | null
    findVendorNow: boolean
  },
): Promise<void> {
  if (params.previousVendorId) {
    const vendorName = await loadVendorName(supabase, params.previousVendorId)
    try {
      await textVendorWithdrawn(supabase, {
        ticketId: params.ticketId,
        landlordId: params.landlordId,
        vendorId: params.previousVendorId,
        vendorName,
      })
    } catch (e) {
      console.error("[admin-stage-move] withdraw SMS", e)
    }
  }

  await supabase
    .from("maintenance_requests")
    .update({
      assigned_vendor_id: null,
      vendor_work_status: "unassigned",
      vendor_notified_at: null,
      vendor_notify_error: null,
    })
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)

  await closeOpenAsksForTicket(
    supabase,
    params.ticketId,
    "admin_stage_move → new_intake",
  )

  if (params.findVendorNow) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("priority, urgency, unit, description, issue_headline")
      .eq("id", params.ticketId)
      .maybeSingle()
    await assignVendorAndNotify(supabase, {
      ticketId: params.ticketId,
      landlordId: params.landlordId,
      landlordAcknowledged: true,
      retryIfUnassigned: true,
      priority:
        typeof ticket?.priority === "string" && ticket.priority.trim()
          ? ticket.priority.trim()
          : typeof ticket?.urgency === "string" && ticket.urgency.trim()
            ? ticket.urgency.trim()
            : "normal",
      unit: typeof ticket?.unit === "string" ? ticket.unit : "",
      description: typeof ticket?.description === "string" ? ticket.description : "",
      issueHeadline:
        typeof ticket?.issue_headline === "string" ? ticket.issue_headline : null,
    })
  }
}

async function moveToAssigned(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    vendorId: string
  },
): Promise<void> {
  // Prefer the shared reassignment path so the vendor gets YES/NO.
  const { reassignVendorByIdAndNotify } = await import(
    "../../submit-maintenance-request/vendor_notify.ts"
  )
  const result = await reassignVendorByIdAndNotify(
    supabase,
    params.ticketId,
    params.vendorId,
  )
  if ("error" in result) {
    // Fall back to status-only if already assigned to this vendor.
    await supabase
      .from("maintenance_requests")
      .update({ vendor_work_status: "pending_accept" })
      .eq("id", params.ticketId)
      .eq("landlord_id", params.landlordId)
  }
}

async function moveToInProgress(
  supabase: SupabaseClient,
  params: { landlordId: string; ticketId: string },
): Promise<void> {
  await supabase
    .from("maintenance_requests")
    .update({ vendor_work_status: "in_progress" })
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)

  await closeOpenAsksForTicket(
    supabase,
    params.ticketId,
    "admin_stage_move → in_progress",
  )
}

async function moveToCompleted(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    runId: string
    note?: string | null
    vendorId: string | null
  },
): Promise<void> {
  const now = new Date().toISOString()
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_work_status: "completed",
      completed_at: now,
    })
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)

  try {
    await markMaintenanceJobCompleted(supabase, params.ticketId)
  } catch (e) {
    console.error("[admin-stage-move] markMaintenanceJobCompleted", e)
  }

  await closeOpenAsksForTicket(
    supabase,
    params.ticketId,
    "admin_stage_move → completed",
  )

  await updateWorkflowRun(supabase, params.runId, {
    status: "completed",
    currentStep: "completed",
    completedAt: now,
  })

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select(
      "resident_name, email, resident_phone, resident_notification_channel, unit, priority, assigned_vendor_id",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (ticket) {
    let vendorName: string | undefined
    const vid =
      params.vendorId ||
      (typeof ticket.assigned_vendor_id === "string"
        ? ticket.assigned_vendor_id
        : null)
    if (vid) vendorName = await loadVendorName(supabase, vid)
    try {
      await notifyResidentCompleted(supabase, {
        ticketId: params.ticketId,
        recipientName: String(ticket.resident_name ?? ""),
        recipientEmail:
          typeof ticket.email === "string" ? ticket.email.trim() : "",
        recipientPhone:
          typeof ticket.resident_phone === "string"
            ? ticket.resident_phone
            : null,
        notificationChannel:
          typeof ticket.resident_notification_channel === "string"
            ? ticket.resident_notification_channel
            : null,
        unit: typeof ticket.unit === "string" ? ticket.unit : undefined,
        priority:
          typeof ticket.priority === "string" ? ticket.priority : undefined,
        vendorName,
      })
    } catch (e) {
      console.error("[admin-stage-move] resident completed notify", e)
    }
  }
}

async function reopenFromCompleted(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    runId: string
    toStage: WorkflowKanbanStageId
    vendorId: string | null
    notifyVendorAndTenant: boolean
  },
): Promise<void> {
  const statusByStage: Record<Exclude<WorkflowKanbanStageId, "completed">, string> = {
    new_intake: "unassigned",
    assigned: "pending_accept",
    in_progress: "in_progress",
  }
  const vendorWorkStatus =
    params.toStage === "completed"
      ? "completed"
      : statusByStage[params.toStage as Exclude<WorkflowKanbanStageId, "completed">]

  const patch: Record<string, unknown> = {
    vendor_work_status: vendorWorkStatus,
    completed_at: null,
  }
  if (params.toStage === "new_intake") {
    patch.assigned_vendor_id = null
  }

  await supabase
    .from("maintenance_requests")
    .update(patch)
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)

  await updateWorkflowRun(supabase, params.runId, {
    status: "active",
    currentStep: params.toStage,
    completedAt: null,
  })

  if (params.toStage === "new_intake") {
    await closeOpenAsksForTicket(
      supabase,
      params.ticketId,
      "admin_stage_move reopen → new_intake",
    )
  }

  if (params.notifyVendorAndTenant && params.vendorId && params.toStage !== "new_intake") {
    const vendorName = await loadVendorName(supabase, params.vendorId)
    const { data: vendor } = await supabase
      .from("vendors")
      .select("phone")
      .eq("id", params.vendorId)
      .maybeSingle()
    const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
    if (phone) {
      const wo = formatWorkOrderRef(params.ticketId)
      const body = [
        `Hi ${vendorName},`,
        "",
        `Update for work order ${wo}.`,
        "",
        `The property team reopened this job and marked it as ${stageLabel(params.toStage)}.`,
        "You can continue from here.",
      ].join("\n")
      try {
        await sendVendorJobAlert(supabase, {
          ticketId: params.ticketId,
          vendorId: params.vendorId,
          vendorPhone: phone,
          body,
          landlordId: params.landlordId,
        })
      } catch (e) {
        console.error("[admin-stage-move] reopen vendor SMS", e)
      }
    }
  }
}

async function loadTicketsForMove(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    inspectionReportId?: string | null
    ticketIds?: string[] | null
  },
): Promise<{ ok: true; tickets: TicketRow[]; visit: boolean } | { ok: false; status: number; error: string }> {
  const reportId = params.inspectionReportId?.trim() || ""
  if (reportId) {
    const { data, error } = await supabase
      .from("maintenance_requests")
      .select(
        "id, landlord_id, assigned_vendor_id, vendor_work_status, completed_at, inspection_report_id",
      )
      .eq("landlord_id", params.landlordId)
      .eq("inspection_report_id", reportId)

    if (error) {
      return { ok: false, status: 500, error: "Could not load inspection visit tickets" }
    }
    let tickets = (data ?? []) as TicketRow[]
    const scope = (params.ticketIds ?? [])
      .map((id) => id.trim())
      .filter(Boolean)
    if (scope.length > 0) {
      const allowed = new Set(scope)
      tickets = tickets.filter((t) => allowed.has(t.id))
    }
    if (tickets.length === 0) {
      return { ok: false, status: 404, error: "No tickets found for this inspection visit" }
    }
    return { ok: true, tickets, visit: true }
  }

  const { data: ticket, error: ticketErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, vendor_work_status, completed_at, inspection_report_id",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (ticketErr || !ticket?.id) {
    return { ok: false, status: 404, error: "Ticket not found" }
  }

  const ticketLandlord =
    typeof ticket.landlord_id === "string" ? ticket.landlord_id.trim() : ""
  if (!ticketLandlord || ticketLandlord !== params.landlordId) {
    return { ok: false, status: 403, error: "Forbidden" }
  }

  return { ok: true, tickets: [ticket as TicketRow], visit: false }
}

async function loadRunIdByTicketId(
  supabase: SupabaseClient,
  landlordId: string,
  ticketIds: string[],
  primaryRunId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ticketIds.length === 0) return map

  const { data } = await supabase
    .from("workflow_runs")
    .select("id, entity_id, landlord_id")
    .eq("landlord_id", landlordId)
    .in("entity_id", ticketIds)

  for (const row of data ?? []) {
    const entityId = typeof row.entity_id === "string" ? row.entity_id.trim() : ""
    const id = typeof row.id === "string" ? row.id.trim() : ""
    if (entityId && id && !map.has(entityId)) map.set(entityId, id)
  }

  // Primary card run is always associated even if entity_id differs.
  if (ticketIds[0] && !map.has(ticketIds[0])) {
    map.set(ticketIds[0], primaryRunId)
  }
  return map
}

async function applyOneTicketStageMove(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    runId: string
    previousVendorId: string | null
    fromStage: WorkflowKanbanStageId
    toStage: WorkflowKanbanStageId
    findVendorNow: boolean
    notifyVendorAndTenant: boolean
    note?: string | null
  },
): Promise<void> {
  const fromCompleted = params.fromStage === "completed"
  if (fromCompleted && params.toStage !== "completed") {
    await reopenFromCompleted(supabase, {
      landlordId: params.landlordId,
      ticketId: params.ticketId,
      runId: params.runId,
      toStage: params.toStage,
      vendorId: params.previousVendorId,
      notifyVendorAndTenant: params.notifyVendorAndTenant,
    })
    return
  }
  if (params.toStage === "new_intake") {
    await moveToNewIntake(supabase, {
      landlordId: params.landlordId,
      ticketId: params.ticketId,
      previousVendorId: params.previousVendorId,
      findVendorNow: params.findVendorNow,
    })
    return
  }
  if (params.toStage === "assigned") {
    await moveToAssigned(supabase, {
      landlordId: params.landlordId,
      ticketId: params.ticketId,
      vendorId: params.previousVendorId!,
    })
    return
  }
  if (params.toStage === "in_progress") {
    await moveToInProgress(supabase, {
      landlordId: params.landlordId,
      ticketId: params.ticketId,
    })
    return
  }
  if (params.toStage === "completed") {
    await moveToCompleted(supabase, {
      landlordId: params.landlordId,
      ticketId: params.ticketId,
      runId: params.runId,
      note: params.note,
      vendorId: params.previousVendorId,
    })
  }
}

export async function applyAdminStageMove(
  supabase: SupabaseClient,
  input: ApplyAdminStageMoveInput,
): Promise<ApplyAdminStageMoveResult> {
  const landlordId = input.landlordId.trim()
  const runId = input.runId.trim()
  const ticketId = input.ticketId.trim()
  if (!landlordId || !runId || !ticketId) {
    return { ok: false, status: 400, error: "Missing landlordId, runId, or ticketId" }
  }

  const { data: run, error: runErr } = await supabase
    .from("workflow_runs")
    .select("id, landlord_id, entity_type, entity_id, status, current_step, metadata, template_id")
    .eq("id", runId)
    .maybeSingle()

  if (runErr || !run?.id) {
    return { ok: false, status: 404, error: "Workflow run not found" }
  }

  const runLandlord = typeof run.landlord_id === "string" ? run.landlord_id.trim() : ""
  if (runLandlord && runLandlord !== landlordId) {
    return { ok: false, status: 403, error: "Forbidden" }
  }

  const loaded = await loadTicketsForMove(supabase, {
    landlordId,
    ticketId,
    inspectionReportId: input.inspectionReportId,
    ticketIds: input.ticketIds,
  })
  if (!loaded.ok) {
    return { ok: false, status: loaded.status, error: loaded.error }
  }

  const { tickets, visit } = loaded

  const currentStage = visit
    ? deriveInspectionVisitKanbanStage(
      tickets.map((t) => ({
        vendorWorkStatus: t.vendor_work_status,
        assignedVendorId: t.assigned_vendor_id,
      })),
    )
    : deriveTicketKanbanStage({
      vendorWorkStatus: tickets[0]!.vendor_work_status,
      assignedVendorId: tickets[0]!.assigned_vendor_id,
      runStatus: run.status,
      currentStep: run.current_step,
    })

  if (currentStage !== input.fromStage) {
    return {
      ok: false,
      status: 409,
      error: "Stage changed — refresh and try again",
      currentStage,
    }
  }

  const fromCompleted = input.fromStage === "completed"
  const targets = fromCompleted
    ? tickets.filter((t) => isTerminalStatus(t.vendor_work_status))
    : tickets.filter((t) => !isTerminalStatus(t.vendor_work_status))

  // Completing / forward-moving with nothing open is a no-op success when already done.
  const moveTargets =
    targets.length > 0
      ? targets
      : visit && input.toStage === "completed"
        ? tickets
        : tickets.slice(0, 1)

  const needsVendor =
    input.toStage === "assigned" || input.toStage === "in_progress"
  if (needsVendor && !fromCompleted) {
    const missing = moveTargets.filter(
      (t) => !(typeof t.assigned_vendor_id === "string" && t.assigned_vendor_id.trim()),
    )
    if (missing.length > 0) {
      return {
        ok: false,
        status: 422,
        error: "Needs a vendor first",
      }
    }
  }

  const runByTicket = await loadRunIdByTicketId(
    supabase,
    landlordId,
    moveTargets.map((t) => t.id),
    runId,
  )

  try {
    for (const ticket of moveTargets) {
      const previousVendorId =
        typeof ticket.assigned_vendor_id === "string" && ticket.assigned_vendor_id.trim()
          ? ticket.assigned_vendor_id.trim()
          : null
      const siblingRunId = runByTicket.get(ticket.id) ?? runId
      await applyOneTicketStageMove(supabase, {
        landlordId,
        ticketId: ticket.id,
        runId: siblingRunId,
        previousVendorId,
        fromStage: input.fromStage,
        toStage: input.toStage,
        findVendorNow: input.findVendorNow === true,
        notifyVendorAndTenant: input.notifyVendorAndTenant === true,
        note: input.note,
      })
    }
  } catch (e) {
    console.error("[admin-stage-move] apply", e)
    return { ok: false, status: 500, error: "Stage move failed" }
  }

  const now = new Date().toISOString()
  const override = {
    stage: input.toStage,
    at: now,
    by: input.actorId?.trim() || "landlord",
  }

  const runsToPatch = new Set<string>([runId])
  for (const id of runByTicket.values()) runsToPatch.add(id)

  for (const patchRunId of runsToPatch) {
    await updateWorkflowRun(supabase, patchRunId, {
      status: input.toStage === "completed" ? "completed" : "active",
      currentStep: input.toStage,
      completedAt: input.toStage === "completed" ? now : null,
      metadata: {
        manual_stage_override: override,
        last_admin_stage_move: {
          from: input.fromStage,
          to: input.toStage,
          at: now,
          note: input.note?.trim() || null,
          inspection_report_id: input.inspectionReportId?.trim() || null,
          ticket_ids: moveTargets.map((t) => t.id),
        },
      },
      eventStep: "admin_stage_move",
      eventMessage: visit
        ? `Moved inspection visit to ${stageLabel(input.toStage)}`
        : `Moved to ${stageLabel(input.toStage)}`,
      eventType: "workflow.admin_stage_move",
    })
  }

  await recordActivityLog(supabase, {
    landlordId,
    eventType: "maintenance.admin_stage_moved",
    source: "dashboard",
    actorType: "landlord",
    actorId: input.actorId ?? null,
    maintenanceRequestId: ticketId,
    workflowRunId: runId,
    workflowTemplateId:
      typeof run.template_id === "string" ? run.template_id : null,
    metadata: {
      message: visit
        ? `You moved this inspection visit to ${stageLabel(input.toStage)}`
        : `You moved this to ${stageLabel(input.toStage)}`,
      from: input.fromStage,
      to: input.toStage,
      note: input.note?.trim() || null,
      actor: override.by,
      inspection_report_id: input.inspectionReportId?.trim() || null,
      ticket_ids: moveTargets.map((t) => t.id),
    },
  }).catch(() => {})

  const { data: refreshed } = await supabase
    .from("maintenance_requests")
    .select("vendor_work_status, assigned_vendor_id")
    .eq("id", ticketId)
    .maybeSingle()

  return {
    ok: true,
    stage: input.toStage,
    vendorWorkStatus:
      typeof refreshed?.vendor_work_status === "string"
        ? refreshed.vendor_work_status
        : null,
    assignedVendorId:
      typeof refreshed?.assigned_vendor_id === "string"
        ? refreshed.assigned_vendor_id
        : null,
  }
}
