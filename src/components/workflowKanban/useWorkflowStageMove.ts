import { useCallback, useRef, useState } from 'react'
import {
  AdminMoveWorkflowStageError,
  postAdminMoveWorkflowStage,
} from '@/api/adminMoveWorkflowStage'
import { postAdminReassignVendor, resolveAdminReassignUrl } from '@/api/adminReassignVendor'
import { requireAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import type { WorkflowKanbanCard, WorkflowKanbanStageId } from '@/lib/adminWorkflowKanban'
import { WORKFLOW_STAGE_LABEL } from '@/lib/adminWorkflowKanban'
import { resolveStageMoveGate, type StageMoveGate } from '@/lib/workflowStageMoveRules'
import {
  cardHasAssignedVendorForStageMove,
  canStageMoveKanbanCard,
  isInspectionVisitKanbanCard,
  stageMoveTemplateGroupForCard,
  stageMoveTicketIdsForCard,
} from '@/lib/workflowStageMoveCard'
import type { StageMoveConfirmRequest } from './WorkflowStageMoveDialogs'

export type StageMoveToast = {
  message: string
  undoFrom: WorkflowKanbanStageId
  undoTo: WorkflowKanbanStageId
  runId: string
  ticketId: string
  inspectionReportId: string | null
  ticketIds: string[]
}

type OptimisticPatch = {
  runId: string
  stage: WorkflowKanbanStageId
}

function movePayloadFromCard(card: WorkflowKanbanCard) {
  const ticketIds = stageMoveTicketIdsForCard(card)
  const ticketId = card.ticketId?.trim() || ticketIds[0] || ''
  const inspectionReportId = isInspectionVisitKanbanCard(card)
    ? card.inspectionReportId?.trim() || null
    : null
  return { ticketId, ticketIds, inspectionReportId }
}

export function useWorkflowStageMove(opts: {
  onReload: () => void | Promise<void>
  vendorOptions?: string[]
}) {
  const [optimistic, setOptimistic] = useState<OptimisticPatch | null>(null)
  const [confirm, setConfirm] = useState<StageMoveConfirmRequest | null>(null)
  const [vendorModalCard, setVendorModalCard] = useState<WorkflowKanbanCard | null>(null)
  const [pendingAssignedTarget, setPendingAssignedTarget] = useState<{
    card: WorkflowKanbanCard
    fromStage: WorkflowKanbanStageId
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<StageMoveToast | null>(null)
  const toastTimer = useRef<number | null>(null)
  const pendingAssignedRef = useRef(pendingAssignedTarget)
  pendingAssignedRef.current = pendingAssignedTarget

  const clearToastTimer = () => {
    if (toastTimer.current != null) {
      window.clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
  }

  const showToast = useCallback((next: StageMoveToast) => {
    clearToastTimer()
    setToast(next)
    toastTimer.current = window.setTimeout(() => setToast(null), 10_000)
  }, [])

  const gateFor = useCallback((card: WorkflowKanbanCard, to: WorkflowKanbanStageId): StageMoveGate => {
    return resolveStageMoveGate(card.stage, to, {
      templateGroup: stageMoveTemplateGroupForCard(card),
      hasAssignedVendor: cardHasAssignedVendorForStageMove(card),
      fromCompleted: card.stage === 'completed',
    })
  }, [])

  const executeMove = useCallback(
    async (input: {
      card: WorkflowKanbanCard
      fromStage: WorkflowKanbanStageId
      toStage: WorkflowKanbanStageId
      findVendorNow?: boolean
      notifyVendorAndTenant?: boolean
      note?: string
      skipOptimistic?: boolean
    }) => {
      const { ticketId, ticketIds, inspectionReportId } = movePayloadFromCard(input.card)
      if (!ticketId) {
        setError('This card is not linked to a work order.')
        return false
      }

      setBusy(true)
      setError(null)
      if (!input.skipOptimistic) {
        setOptimistic({ runId: input.card.id, stage: input.toStage })
      }

      try {
        await postAdminMoveWorkflowStage({
          runId: input.card.id,
          ticketId,
          inspectionReportId,
          ticketIds,
          fromStage: input.fromStage,
          toStage: input.toStage,
          findVendorNow: input.findVendorNow,
          notifyVendorAndTenant: input.notifyVendorAndTenant,
          note: input.note,
        })
        showToast({
          message: `Moved to ${WORKFLOW_STAGE_LABEL[input.toStage]}`,
          undoFrom: input.toStage,
          undoTo: input.fromStage,
          runId: input.card.id,
          ticketId,
          inspectionReportId,
          ticketIds,
        })
        await opts.onReload()
        setOptimistic(null)
        return true
      } catch (err) {
        setOptimistic(null)
        if (err instanceof AdminMoveWorkflowStageError && err.status === 409) {
          setError(err.message)
          await opts.onReload()
        } else {
          setError(err instanceof Error ? err.message : 'Could not move this card.')
        }
        return false
      } finally {
        setBusy(false)
        setConfirm(null)
      }
    },
    [opts, showToast],
  )

  const requestMove = useCallback(
    async (card: WorkflowKanbanCard, toStage: WorkflowKanbanStageId) => {
      setError(null)
      if (!canStageMoveKanbanCard(card)) {
        setError('This card cannot be moved.')
        return
      }
      const gate = gateFor(card, toStage)
      if (gate.kind === 'not_draggable' || gate.kind === 'blocked') {
        setError(gate.reason)
        return
      }
      if (gate.kind === 'needs_vendor_modal') {
        setPendingAssignedTarget({ card, fromStage: card.stage })
        setVendorModalCard(card)
        return
      }
      const { ticketId } = movePayloadFromCard(card)
      if (gate.kind === 'needs_confirm') {
        setConfirm({
          kind: gate.confirmKind,
          runId: card.id,
          ticketId,
          fromStage: card.stage,
          toStage,
          vendorName: card.assignedVendorName,
          visitGroup: isInspectionVisitKanbanCard(card),
          openItemCount: isInspectionVisitKanbanCard(card)
            ? card.inspectionChecklist?.filter((item) => item.stage !== 'completed').length ??
              stageMoveTicketIdsForCard(card).length
            : 1,
        })
        return
      }
      await executeMove({ card, fromStage: card.stage, toStage })
    },
    [executeMove, gateFor],
  )

  const onVendorPicked = useCallback(
    async (vendorName: string) => {
      const pending = pendingAssignedRef.current
      if (!pending) return
      const ticketIds = stageMoveTicketIdsForCard(pending.card)
      const unfinishedIds =
        isInspectionVisitKanbanCard(pending.card) && pending.card.inspectionChecklist?.length
          ? pending.card.inspectionChecklist
              .filter((item) => item.stage !== 'completed')
              .map((item) => item.ticketId.trim())
              .filter(Boolean)
          : ticketIds
      const targets = unfinishedIds.length > 0 ? unfinishedIds : ticketIds
      if (targets.length === 0) return

      const url = resolveAdminReassignUrl()
      if (!url) {
        setError('Vendor reassignment is not configured.')
        return
      }
      setBusy(true)
      setError(null)
      setOptimistic({ runId: pending.card.id, stage: 'assigned' })
      try {
        const secret = requireAdminEdgeSecret('Reassign vendor')
        for (const ticketId of targets) {
          await postAdminReassignVendor({
            url,
            secret,
            ticketId,
            vendorName,
            createVendorIfMissing: true,
          })
        }
        const { ticketId, inspectionReportId } = movePayloadFromCard(pending.card)
        showToast({
          message: `Moved to ${WORKFLOW_STAGE_LABEL.assigned}`,
          undoFrom: 'assigned',
          undoTo: pending.fromStage,
          runId: pending.card.id,
          ticketId: ticketId || targets[0]!,
          inspectionReportId,
          ticketIds: targets,
        })
        setVendorModalCard(null)
        setPendingAssignedTarget(null)
        await opts.onReload()
        setOptimistic(null)
      } catch (err) {
        setOptimistic(null)
        setError(err instanceof Error ? err.message : 'Could not assign vendor.')
      } finally {
        setBusy(false)
      }
    },
    [opts, showToast],
  )

  const undoMove = useCallback(async () => {
    if (!toast) return
    clearToastTimer()
    const snapshot = toast
    setToast(null)
    setBusy(true)
    try {
      await postAdminMoveWorkflowStage({
        runId: snapshot.runId,
        ticketId: snapshot.ticketId,
        inspectionReportId: snapshot.inspectionReportId,
        ticketIds: snapshot.ticketIds,
        fromStage: snapshot.undoFrom,
        toStage: snapshot.undoTo,
      })
      await opts.onReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed.')
      await opts.onReload()
    } finally {
      setBusy(false)
    }
  }, [opts, toast])

  const applyOptimisticStage = useCallback(
    (card: WorkflowKanbanCard): WorkflowKanbanStageId => {
      if (optimistic?.runId === card.id) return optimistic.stage
      return card.stage
    },
    [optimistic],
  )

  return {
    confirm,
    setConfirm,
    vendorModalCard,
    setVendorModalCard,
    cancelVendorModal: () => {
      setVendorModalCard(null)
      setPendingAssignedTarget(null)
      setOptimistic(null)
    },
    busy,
    error,
    setError,
    toast,
    requestMove,
    executeMove,
    onVendorPicked,
    undoMove,
    gateFor,
    applyOptimisticStage,
    vendorOptions: opts.vendorOptions ?? [],
  }
}
