/**
 * POST admin-move-workflow-stage (ADMIN_REASSIGN_SECRET).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
  formatAdminEdgeUnauthorizedError,
  requireAdminEdgeSecret,
} from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import type { WorkflowKanbanStageId } from '@/lib/adminWorkflowKanban'

export function resolveAdminMoveWorkflowStageUrl(): string | null {
  const explicit = import.meta.env.VITE_ADMIN_MOVE_WORKFLOW_STAGE_URL?.trim()
  if (explicit) return explicit
  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(/admin-reassign-vendor\/?$/, 'admin-move-workflow-stage')
  }
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/admin-move-workflow-stage`
  return null
}

export type AdminMoveWorkflowStageInput = {
  runId: string
  ticketId: string
  /** Inspection visit rollup — move every open fail-item under this report. */
  inspectionReportId?: string | null
  ticketIds?: string[] | null
  fromStage: WorkflowKanbanStageId
  toStage: WorkflowKanbanStageId
  note?: string | null
  findVendorNow?: boolean
  notifyVendorAndTenant?: boolean
}

export type AdminMoveWorkflowStageOk = {
  ok: true
  stage: WorkflowKanbanStageId
  vendor_work_status: string | null
  assigned_vendor_id: string | null
}

export class AdminMoveWorkflowStageError extends Error {
  status: number
  currentStage?: WorkflowKanbanStageId
  constructor(message: string, status: number, currentStage?: WorkflowKanbanStageId) {
    super(message)
    this.name = 'AdminMoveWorkflowStageError'
    this.status = status
    this.currentStage = currentStage
  }
}

export async function postAdminMoveWorkflowStage(
  input: AdminMoveWorkflowStageInput,
): Promise<AdminMoveWorkflowStageOk> {
  const url = resolveAdminMoveWorkflowStageUrl()
  const secret = requireAdminEdgeSecret('Move workflow stage')
  if (!url) {
    throw new Error('Stage move is not configured (admin Edge URL).')
  }

  const landlordId = getActiveLandlordId()
  if (!landlordId) {
    throw new Error('No active landlord selected.')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      landlordId,
      runId: input.runId.trim(),
      ticketId: input.ticketId.trim(),
      inspectionReportId: input.inspectionReportId?.trim() || null,
      ticketIds: (input.ticketIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
      fromStage: input.fromStage,
      toStage: input.toStage,
      note: input.note?.trim() || null,
      findVendorNow: input.findVendorNow === true,
      notifyVendorAndTenant: input.notifyVendorAndTenant === true,
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    currentStage?: WorkflowKanbanStageId
    ok?: boolean
    stage?: WorkflowKanbanStageId
    vendor_work_status?: string | null
    assigned_vendor_id?: string | null
  }

  if (res.status === 401) {
    throw new Error(
      formatAdminEdgeUnauthorizedError(payload.error ?? 'Stage move unauthorized'),
    )
  }

  if (!res.ok) {
    throw new AdminMoveWorkflowStageError(
      payload.error ?? `Stage move failed (${res.status})`,
      res.status,
      payload.currentStage,
    )
  }

  return {
    ok: true,
    stage: (payload.stage ?? input.toStage) as WorkflowKanbanStageId,
    vendor_work_status: payload.vendor_work_status ?? null,
    assigned_vendor_id: payload.assigned_vendor_id ?? null,
  }
}
