import { describe, expect, it } from 'vitest'
import type { WorkflowKanbanCard } from './adminWorkflowKanban'
import {
  canStageMoveKanbanCard,
  cardHasAssignedVendorForStageMove,
  isInspectionVisitKanbanCard,
  stageMoveTemplateGroupForCard,
  stageMoveTicketIdsForCard,
} from './workflowStageMoveCard'

function card(partial: Partial<WorkflowKanbanCard>): WorkflowKanbanCard {
  return {
    id: 'run-1',
    title: 'WO-TEST',
    context: 'Unit 1',
    category: 'maintenance',
    issueCategoryLabel: 'Plumbing',
    workOrderRef: 'WO-TEST',
    workOrderSummary: 'Sink leak',
    stage: 'new_intake',
    critical: false,
    initials: 'AB',
    templateId: 'maintenance_request',
    ticketId: 'ticket-1',
    stageMoveTicketIds: ['ticket-1'],
    assignedVendorId: null,
    assignedVendorName: null,
    inspectionReportId: null,
    inspectionChecklist: null,
    ...partial,
  }
}

describe('workflowStageMoveCard', () => {
  it('treats multi-ticket inspection rollups as visit cards under the inspection group', () => {
    const visit = card({
      category: 'inspection',
      title: 'Inspection visit · IR-1',
      templateId: 'maintenance_request',
      inspectionReportId: 'report-1',
      ticketId: 't1',
      stageMoveTicketIds: ['t1', 't2'],
      inspectionChecklist: [
        {
          ticketId: 't1',
          workOrderRef: 'WO-1',
          label: 'Stove',
          statusLabel: 'Unassigned',
          stage: 'new_intake',
          runId: 'r1',
          assignedVendorId: null,
        },
        {
          ticketId: 't2',
          workOrderRef: 'WO-2',
          label: 'Outlet',
          statusLabel: 'Unassigned',
          stage: 'new_intake',
          runId: 'r2',
          assignedVendorId: null,
        },
      ],
    })
    expect(isInspectionVisitKanbanCard(visit)).toBe(true)
    expect(stageMoveTemplateGroupForCard(visit)).toBe('inspection')
    expect(canStageMoveKanbanCard(visit)).toBe(true)
    expect(stageMoveTicketIdsForCard(visit)).toEqual(['t1', 't2'])
    expect(cardHasAssignedVendorForStageMove(visit)).toBe(false)
  })

  it('requires every unfinished visit sibling to have a vendor', () => {
    const visit = card({
      inspectionReportId: 'report-1',
      stageMoveTicketIds: ['t1', 't2'],
      inspectionChecklist: [
        {
          ticketId: 't1',
          workOrderRef: 'WO-1',
          label: 'A',
          statusLabel: 'Assigned',
          stage: 'assigned',
          runId: 'r1',
          assignedVendorId: 'v1',
        },
        {
          ticketId: 't2',
          workOrderRef: 'WO-2',
          label: 'B',
          statusLabel: 'Unassigned',
          stage: 'new_intake',
          runId: 'r2',
          assignedVendorId: null,
        },
      ],
    })
    expect(cardHasAssignedVendorForStageMove(visit)).toBe(false)

    visit.inspectionChecklist![1]!.assignedVendorId = 'v2'
    expect(cardHasAssignedVendorForStageMove(visit)).toBe(true)
  })

  it('keeps single maintenance cards on the maintenance template group', () => {
    const wo = card({})
    expect(isInspectionVisitKanbanCard(wo)).toBe(false)
    expect(stageMoveTemplateGroupForCard(wo)).toBe('maintenance')
    expect(canStageMoveKanbanCard(wo)).toBe(true)
  })
})
