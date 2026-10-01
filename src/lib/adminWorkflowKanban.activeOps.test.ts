import { describe, expect, it } from 'vitest'
import {
  collectAdminWorkflowRuns,
  isWorkflowRunActiveAt,
  snapshotActiveOperations,
} from './adminWorkflowKanban'
import type { AdminWorkflowDashboardData, AdminWorkflowRow } from './adminWorkflows'
import { emptyAdminWorkflowDashboardData } from './adminWorkflows'

function run(partial: Partial<AdminWorkflowRow> & Pick<AdminWorkflowRow, 'id' | 'templateId'>): AdminWorkflowRow {
  return {
    templateName: partial.templateId,
    templateType: 'other',
    status: 'active',
    currentStep: null,
    entityType: null,
    entityId: null,
    residentId: null,
    residentName: null,
    unitLabel: null,
    propertyLabel: null,
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    lastEventType: null,
    lastEventMessage: null,
    lastEventAt: null,
    escalationReason: null,
    issueCategory: null,
    issueDescription: null,
    vendorWorkStatus: null,
    assignedVendorId: null,
    ...partial,
  }
}

describe('snapshotActiveOperations', () => {
  it('excludes cancelled tickets and vendor onboarding from the KPI', () => {
    const data: AdminWorkflowDashboardData = {
      ...emptyAdminWorkflowDashboardData(),
      active: [
        run({ id: 'm1', templateId: 'maintenance_request' }),
        run({
          id: 'm2',
          templateId: 'maintenance_request',
          vendorWorkStatus: 'cancelled',
        }),
        run({ id: 'v1', templateId: 'vendor_onboarding' }),
      ],
    }
    const snap = snapshotActiveOperations(data)
    expect(snap.total).toBe(1)
    expect(snap.lines).toEqual([{ id: 'maintenance', label: 'Maintenance', count: 1 }])
  })

  it('treats settled runs as inactive for the board-aligned KPI', () => {
    expect(
      isWorkflowRunActiveAt(
        run({
          id: 'm1',
          templateId: 'maintenance_request',
          status: 'active',
          vendorWorkStatus: 'cancelled',
        }),
        Date.now(),
      ),
    ).toBe(false)
  })

  it('excludes rent collection reminder runs from Active Tasks', () => {
    const rent = run({
      id: 'r1',
      templateId: 'rent_collection',
      lastEventType: 'rent.reminder_sent',
      currentStep: 'reminder_sent',
    })
    const empty = emptyAdminWorkflowDashboardData()
    const data: AdminWorkflowDashboardData = {
      ...empty,
      active: [run({ id: 'm1', templateId: 'maintenance_request' })],
      rentCollection: {
        ...empty.rentCollection,
        runs: [rent as AdminWorkflowDashboardData['rentCollection']['runs'][number]],
        reminderSent: [rent as AdminWorkflowDashboardData['rentCollection']['runs'][number]],
        stats: {
          ...empty.rentCollection.stats,
          reminderSentCount: 1,
        },
      },
    }

    expect(collectAdminWorkflowRuns(data).map((row) => row.id)).toEqual(['m1'])
    expect(snapshotActiveOperations(data).total).toBe(1)
    expect(snapshotActiveOperations(data).lines).toEqual([
      { id: 'maintenance', label: 'Maintenance', count: 1 },
    ])
  })
})
