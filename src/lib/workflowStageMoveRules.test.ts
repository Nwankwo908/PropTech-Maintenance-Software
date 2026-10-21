import { describe, expect, it } from 'vitest'
import { deriveMaintenanceKanbanStage } from './adminWorkflowKanban'
import type { AdminWorkflowRow } from './adminWorkflows'
import {
  STAGE_MOVE_RULES,
  resolveStageMoveGate,
  ticketFieldsForTargetStage,
  type WorkflowKanbanStageId,
} from '@shared/workflowStageMove/stageMoveRules'

const STAGES: WorkflowKanbanStageId[] = [
  'new_intake',
  'assigned',
  'in_progress',
  'completed',
]

function row(partial: Partial<AdminWorkflowRow>): AdminWorkflowRow {
  return {
    id: 'run-1',
    templateId: 'maintenance_request',
    templateName: 'Maintenance',
    templateType: 'other',
    status: 'active',
    currentStep: null,
    entityType: 'maintenance_request',
    entityId: 'ticket-1',
    propertyId: null,
    unitId: null,
    residentId: null,
    residentName: null,
    unitLabel: null,
    propertyLabel: null,
    startedAt: '2026-10-17T13:59:07.000Z',
    completedAt: null,
    lastEventType: null,
    lastEventMessage: null,
    lastEventAt: null,
    escalationReason: null,
    issueCategory: 'pest',
    issueDescription: 'Pest',
    vendorWorkStatus: 'unassigned',
    assignedVendorId: null,
    autoReassignLastOutcome: null,
    inspectionReportId: null,
    inspectionGroupItems: null,
    ...partial,
  }
}

describe('STAGE_MOVE_RULES', () => {
  it('marks maintenance and inspection visit rollups as draggable', () => {
    expect(STAGE_MOVE_RULES.maintenance.draggable).toBe(true)
    expect(STAGE_MOVE_RULES.inspection.draggable).toBe(true)
    expect(STAGE_MOVE_RULES.rent_collection.draggable).toBe(false)
    expect(STAGE_MOVE_RULES.move_in.notDraggableReason).toMatch(/move-in/i)
  })

  it('applies the same Assigned/In Progress vendor gates to inspection', () => {
    expect(
      resolveStageMoveGate('new_intake', 'assigned', {
        templateGroup: 'inspection',
        hasAssignedVendor: false,
        fromCompleted: false,
      }).kind,
    ).toBe('needs_vendor_modal')
    expect(
      resolveStageMoveGate('new_intake', 'in_progress', {
        templateGroup: 'inspection',
        hasAssignedVendor: false,
        fromCompleted: false,
      }).kind,
    ).toBe('blocked')
  })

  it('tables each from→to for maintenance with vendor', () => {
    const withVendor = {
      templateGroup: 'maintenance' as const,
      hasAssignedVendor: true,
      fromCompleted: false,
    }
    const expected: Record<
      string,
      Record<string, 'allowed' | 'needs_confirm' | 'blocked' | 'needs_vendor_modal'>
    > = {
      new_intake: {
        new_intake: 'blocked',
        assigned: 'allowed',
        in_progress: 'allowed',
        completed: 'needs_confirm',
      },
      assigned: {
        new_intake: 'needs_confirm',
        assigned: 'blocked',
        in_progress: 'allowed',
        completed: 'needs_confirm',
      },
      in_progress: {
        new_intake: 'needs_confirm',
        assigned: 'allowed',
        in_progress: 'blocked',
        completed: 'needs_confirm',
      },
      completed: {
        new_intake: 'needs_confirm',
        assigned: 'needs_confirm',
        in_progress: 'needs_confirm',
        completed: 'blocked',
      },
    }

    for (const from of STAGES) {
      for (const to of STAGES) {
        const gate = resolveStageMoveGate(from, to, {
          ...withVendor,
          fromCompleted: from === 'completed',
        })
        expect(gate.kind, `${from} → ${to}`).toBe(expected[from]![to])
      }
    }
  })

  it('requires a vendor modal when moving to Assigned without a vendor', () => {
    const gate = resolveStageMoveGate('new_intake', 'assigned', {
      templateGroup: 'maintenance',
      hasAssignedVendor: false,
      fromCompleted: false,
    })
    expect(gate).toEqual({
      kind: 'needs_vendor_modal',
      reason: 'Needs a vendor first',
    })
  })

  it('blocks In Progress without a vendor', () => {
    const gate = resolveStageMoveGate('new_intake', 'in_progress', {
      templateGroup: 'maintenance',
      hasAssignedVendor: false,
      fromCompleted: false,
    })
    expect(gate.kind).toBe('blocked')
    if (gate.kind === 'blocked') {
      expect(gate.reason).toBe('Needs a vendor first')
    }
  })

  it('keeps deriveMaintenanceKanbanStage on the target after server field updates', () => {
    for (const to of STAGES) {
      const fields = ticketFieldsForTargetStage(to, { hasVendor: to !== 'new_intake' })
      expect(
        deriveMaintenanceKanbanStage(
          row({
            vendorWorkStatus: fields.vendorWorkStatus,
            assignedVendorId: fields.assignedVendorId,
          }),
        ),
      ).toBe(to)
    }
  })
})
