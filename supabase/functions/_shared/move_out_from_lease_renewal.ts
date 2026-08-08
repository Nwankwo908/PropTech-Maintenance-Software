import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { resolveDemoMoveOutRunId } from "./demo_workflow_ids.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { startMoveOutWorkflow } from "./engine/startWorkflow.ts"
import {
  getWorkflowRunById,
  updateWorkflowRun,
} from "./engine/workflowRuns.ts"

export type TriggerMoveOutFromLeaseRenewalResult = {
  ok: true
  leaseRenewalRunId: string
  moveOutRunId: string
  conversationId: string | null
} | {
  ok: false
  error: string
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

async function resolveUnitForLeaseRenewal(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unitId: string | null
    unitLabel: string | null
    building: string | null
    residentId: string | null
  },
): Promise<{ unitId: string; unitLabel: string | null; building: string | null } | null> {
  if (params.unitId) {
    return {
      unitId: params.unitId,
      unitLabel: params.unitLabel,
      building: params.building,
    }
  }

  if (!params.residentId) return null

  const { data: resident } = await supabase
    .from("users")
    .select("unit, building")
    .eq("id", params.residentId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  const unitLabel = readString(resident?.unit) ?? params.unitLabel
  const building = readString(resident?.building) ?? params.building
  if (!unitLabel) return null

  let query = supabase
    .from("units")
    .select("id, unit_label, building")
    .eq("landlord_id", params.landlordId)
    .eq("unit_label", unitLabel)

  if (building) query = query.eq("building", building)

  const { data: unit } = await query.limit(1).maybeSingle()
  if (!unit?.id) return null

  return {
    unitId: String(unit.id),
    unitLabel: readString(unit.unit_label) ?? unitLabel,
    building: readString(unit.building) ?? building,
  }
}

/** Complete escalated lease renewal and spawn linked move_out workflow with resident outreach. */
export async function triggerMoveOutFromLeaseRenewal(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    leaseRenewalRunId: string
  },
): Promise<TriggerMoveOutFromLeaseRenewalResult> {
  const leaseRun = await getWorkflowRunById(supabase, params.leaseRenewalRunId)
  if (!leaseRun) {
    return { ok: false, error: "Lease renewal workflow run not found." }
  }
  if (leaseRun.template_id !== "lease_renewal") {
    return { ok: false, error: "Workflow run is not a lease renewal." }
  }
  if (leaseRun.landlord_id && leaseRun.landlord_id !== params.landlordId) {
    return { ok: false, error: "Workflow run does not belong to this landlord." }
  }

  const residentId = leaseRun.resident_id?.trim() || null
  if (!residentId) {
    return { ok: false, error: "Lease renewal run has no resident." }
  }

  const metadata = leaseRun.metadata ?? {}
  const unitLabel =
    readString(metadata.unit_label) ??
    readString((metadata.step_state as Record<string, unknown> | undefined)?.unit_label)
  const building = readString(metadata.building)
  const leaseEndDate =
    readString(metadata.lease_end_date) ??
    readString((metadata.step_state as Record<string, unknown> | undefined)?.lease_end_date)

  const unitScope = await resolveUnitForLeaseRenewal(supabase, {
    landlordId: params.landlordId,
    unitId: leaseRun.unit_id,
    unitLabel,
    building,
    residentId,
  })
  if (!unitScope) {
    return { ok: false, error: "Could not resolve unit for move-out workflow." }
  }

  const { data: resident, error: residentError } = await supabase
    .from("users")
    .select("id, full_name, phone, lease_end_date")
    .eq("id", residentId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (residentError || !resident) {
    return { ok: false, error: residentError?.message ?? "Resident not found." }
  }

  const residentPhone = readString(resident.phone)
  if (!residentPhone) {
    return { ok: false, error: "Resident has no phone on file for SMS outreach." }
  }

  const moveOutDate = leaseEndDate ?? readString(resident.lease_end_date)
  const now = new Date().toISOString()

  const demoMoveOutRunId = resolveDemoMoveOutRunId(params.landlordId)

  const moveOutStart = await startMoveOutWorkflow(supabase, {
    landlordId: params.landlordId,
    unitId: unitScope.unitId,
    residentId,
    unitLabel: unitScope.unitLabel,
    building: unitScope.building,
    moveOutDate,
    triggerType: "dashboard",
    classification: "lease_end",
    reuseActiveRun: false,
    runId: demoMoveOutRunId,
    sourceWorkflowRunId: params.leaseRenewalRunId,
    sourceWorkflowTemplateId: "lease_renewal",
    initialAction: {
      moveOut: {
        action: "send_outreach",
        sourceWorkflowRunId: params.leaseRenewalRunId,
      },
    },
  })

  const moveOutRunId = moveOutStart.workflow_run_id

  await updateWorkflowRun(supabase, params.leaseRenewalRunId, {
    status: "completed",
    currentStep: "completed",
    completedAt: now,
    metadata: {
      response: "move_out",
      admin_triggered_move_out: true,
      linked_move_out_run_id: moveOutRunId,
      resolved_at: now,
      resolved_reason: "admin_move_out_prep",
    },
    pipelineStage: "act",
    eventMessage: "Lease renewal resolved — move-out prep triggered by admin",
    eventStep: "completed",
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "lease.move_out_prep_triggered",
    source: "dashboard",
    actorType: "landlord",
    residentId,
    unitId: unitScope.unitId,
    workflowRunId: params.leaseRenewalRunId,
    workflowTemplateId: "lease_renewal",
    metadata: {
      linked_move_out_run_id: moveOutRunId,
      move_out_date: moveOutDate,
      message: "Move-out prep triggered from lease renewal review",
    },
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "lease.renewal_resolved",
    source: "dashboard",
    actorType: "landlord",
    residentId,
    unitId: unitScope.unitId,
    workflowRunId: params.leaseRenewalRunId,
    workflowTemplateId: "lease_renewal",
    metadata: {
      resolution: "move_out",
      linked_move_out_run_id: moveOutRunId,
    },
  })

  const meta = moveOutStart.engineResult?.metadata ?? {}
  if (meta.outreachSent === false) {
    return {
      ok: false,
      error: "Move-out workflow started but outreach failed.",
    }
  }

  const freshRun = await getWorkflowRunById(supabase, moveOutRunId)
  const conversationId = freshRun?.metadata &&
      typeof freshRun.metadata.conversation_id === "string"
    ? freshRun.metadata.conversation_id
    : null

  return {
    ok: true,
    leaseRenewalRunId: params.leaseRenewalRunId,
    moveOutRunId,
    conversationId,
  }
}
