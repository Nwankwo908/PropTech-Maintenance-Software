/**
 * Active Tasks stage-move policy. Maintenance is draggable in phase 1;
 * other templates keep a rule slot so they can opt in later.
 */

export type WorkflowKanbanStageId =
  | "new_intake"
  | "assigned"
  | "in_progress"
  | "completed"

export type StageMoveTemplateGroup =
  | "maintenance"
  | "rent_collection"
  | "move_in"
  | "move_out"
  | "inspection"
  | "lease"
  | "other"

export type StageMoveGate =
  | { kind: "allowed" }
  | { kind: "blocked"; reason: string }
  | { kind: "needs_vendor_modal"; reason: string }
  | {
      kind: "needs_confirm"
      confirmKind: "new_intake_withdraw" | "complete" | "reopen"
      reason?: string
    }
  | { kind: "not_draggable"; reason: string }

export type StageMoveContext = {
  templateGroup: StageMoveTemplateGroup
  hasAssignedVendor: boolean
  /** True when the card is already in Completed (reopen path). */
  fromCompleted: boolean
}

export const WORKFLOW_STAGE_LABEL: Record<WorkflowKanbanStageId, string> = {
  new_intake: "New Intake",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
}

export const STAGE_MOVE_RULES: Record<
  StageMoveTemplateGroup,
  {
    draggable: boolean
    notDraggableReason: string
  }
> = {
  maintenance: {
    draggable: true,
    notDraggableReason: "",
  },
  rent_collection: {
    draggable: false,
    notDraggableReason: "Stage is set automatically for rent",
  },
  move_in: {
    draggable: false,
    notDraggableReason: "Stage is set automatically for move-in",
  },
  move_out: {
    draggable: false,
    notDraggableReason: "Stage is set automatically for move-out",
  },
  inspection: {
    // Visit rollups move every open fail-item work order together.
    draggable: true,
    notDraggableReason: "",
  },
  lease: {
    draggable: false,
    notDraggableReason: "Stage is set automatically for lease",
  },
  other: {
    draggable: false,
    notDraggableReason: "Stage is set automatically for this workflow",
  },
}

const STAGES: WorkflowKanbanStageId[] = [
  "new_intake",
  "assigned",
  "in_progress",
  "completed",
]

/**
 * Resolve whether a from→to move is allowed, blocked, or needs a modal/confirm.
 * Pure — no I/O.
 */
export function resolveStageMoveGate(
  from: WorkflowKanbanStageId,
  to: WorkflowKanbanStageId,
  ctx: StageMoveContext,
): StageMoveGate {
  const templateRule = STAGE_MOVE_RULES[ctx.templateGroup]
  if (!templateRule.draggable) {
    return {
      kind: "not_draggable",
      reason: templateRule.notDraggableReason,
    }
  }

  if (from === to) {
    return { kind: "blocked", reason: "Already in this stage" }
  }

  if (!STAGES.includes(from) || !STAGES.includes(to)) {
    return { kind: "blocked", reason: "Unknown stage" }
  }

  // Reopening a completed job always needs an explicit confirm (optional notify).
  if (ctx.fromCompleted || from === "completed") {
    return { kind: "needs_confirm", confirmKind: "reopen" }
  }

  if (to === "new_intake") {
    if (ctx.hasAssignedVendor || from !== "new_intake") {
      return { kind: "needs_confirm", confirmKind: "new_intake_withdraw" }
    }
    return { kind: "allowed" }
  }

  if (to === "assigned") {
    if (!ctx.hasAssignedVendor) {
      return {
        kind: "needs_vendor_modal",
        reason: "Needs a vendor first",
      }
    }
    return { kind: "allowed" }
  }

  if (to === "in_progress") {
    if (!ctx.hasAssignedVendor) {
      return { kind: "blocked", reason: "Needs a vendor first" }
    }
    return { kind: "allowed" }
  }

  if (to === "completed") {
    return { kind: "needs_confirm", confirmKind: "complete" }
  }

  return { kind: "allowed" }
}

/** Drop-target validity while dragging (UI highlight). */
export function stageDropValidity(
  from: WorkflowKanbanStageId,
  to: WorkflowKanbanStageId,
  ctx: StageMoveContext,
): { valid: boolean; reason: string | null } {
  const gate = resolveStageMoveGate(from, to, ctx)
  if (gate.kind === "allowed" || gate.kind === "needs_confirm" || gate.kind === "needs_vendor_modal") {
    return { valid: true, reason: gate.kind === "needs_vendor_modal" ? gate.reason : null }
  }
  if (gate.kind === "blocked" || gate.kind === "not_draggable") {
    return { valid: false, reason: gate.reason }
  }
  return { valid: false, reason: "Cannot move here" }
}

export function templateGroupFromTemplateId(
  templateId: string | null | undefined,
): StageMoveTemplateGroup {
  const id = (templateId ?? "").trim().toLowerCase()
  if (id === "rent_collection") return "rent_collection"
  if (id === "move_in") return "move_in"
  if (id === "move_out") return "move_out"
  if (id === "inspection" || id.startsWith("inspection")) return "inspection"
  if (id.includes("lease")) return "lease"
  if (
    id === "maintenance_intake" ||
    id === "maintenance_request" ||
    id === "vendor_job_response" ||
    id.includes("maintenance")
  ) {
    return "maintenance"
  }
  return "other"
}

/**
 * Ticket fields that `deriveMaintenanceKanbanStage` reads after a successful move.
 * Used in unit tests to prove no snap-back.
 */
export function ticketFieldsForTargetStage(
  to: WorkflowKanbanStageId,
  opts: { hasVendor: boolean },
): { vendorWorkStatus: string; assignedVendorId: string | null } {
  switch (to) {
    case "new_intake":
      return { vendorWorkStatus: "unassigned", assignedVendorId: null }
    case "assigned":
      return {
        vendorWorkStatus: "pending_accept",
        assignedVendorId: opts.hasVendor ? "vendor-assigned" : null,
      }
    case "in_progress":
      return {
        vendorWorkStatus: "in_progress",
        assignedVendorId: opts.hasVendor ? "vendor-assigned" : null,
      }
    case "completed":
      return {
        vendorWorkStatus: "completed",
        assignedVendorId: opts.hasVendor ? "vendor-assigned" : null,
      }
  }
}
