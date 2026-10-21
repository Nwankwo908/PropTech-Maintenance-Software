import { describe, expect, it } from 'vitest'
import { deriveMaintenanceKanbanStage } from './adminWorkflowKanban'
import type { AdminWorkflowRow } from './adminWorkflows'

function row(partial: Partial<AdminWorkflowRow>): AdminWorkflowRow {
  return {
    id: 'run-1',
    templateId: 'maintenance_intake',
    templateName: 'Maintenance intake',
    templateType: 'other',
    status: 'active',
    currentStep: null,
    entityType: 'maintenance_request',
    entityId: 'fd7b189c-f7ce-4774-a352-bf3c088abd32',
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
    issueDescription: 'Exterminator requested',
    vendorWorkStatus: 'unassigned',
    assignedVendorId: null,
    autoReassignLastOutcome: null,
    inspectionReportId: null,
    inspectionGroupItems: null,
    ...partial,
  }
}

describe('deriveMaintenanceKanbanStage', () => {
  it('keeps an open repair in New Intake after intake closed for a status ask', () => {
    expect(
      deriveMaintenanceKanbanStage(
        row({
          status: 'completed',
          completedAt: '2026-10-20T11:55:06.915Z',
          currentStep: 'intent_maintenance_status',
          vendorWorkStatus: 'unassigned',
        }),
      ),
    ).toBe('new_intake')
  })

  it('shows assignment status when a vendor is awaiting accept', () => {
    expect(
      deriveMaintenanceKanbanStage(
        row({
          status: 'completed',
          templateId: 'maintenance_request',
          vendorWorkStatus: 'pending_accept',
          assignedVendorId: 'vendor-1',
        }),
      ),
    ).toBe('assigned')
  })

  it('only puts repairs in Completed when vendor work is finished', () => {
    expect(
      deriveMaintenanceKanbanStage(
        row({
          status: 'completed',
          templateId: 'maintenance_request',
          vendorWorkStatus: 'completed',
        }),
      ),
    ).toBe('completed')
  })
})
