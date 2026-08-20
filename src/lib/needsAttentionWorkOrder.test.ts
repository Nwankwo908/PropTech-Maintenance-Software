import { describe, expect, it } from 'vitest'
import {
  emptyAdminWorkflowDashboardData,
  type AdminWorkflowDashboardData,
  type AdminWorkflowRow,
} from './adminWorkflows'
import {
  collectCompletedWorkOrderTicketIds,
  shouldOmitEscalatedRunFromNeedsAttention,
} from './needsAttentionWorkOrder'

function run(overrides: Partial<AdminWorkflowRow> & Pick<AdminWorkflowRow, 'id'>): AdminWorkflowRow {
  return {
    templateId: 'maintenance_request',
    templateName: 'Maintenance Request',
    templateType: 'maintenance',
    status: 'escalated',
    currentStep: 'act',
    entityType: 'maintenance_request',
    entityId: 'ticket-1',
    residentId: null,
    residentName: 'Saad Iqbal',
    unitLabel: '4B',
    propertyLabel: 'Oak Tower',
    startedAt: '2026-08-01T12:00:00.000Z',
    completedAt: null,
    lastEventType: 'workflow.escalate',
    lastEventMessage: null,
    lastEventAt: '2026-08-01T13:00:00.000Z',
    escalationReason: 'no_vendor_available',
    issueCategory: 'plumbing',
    vendorWorkStatus: 'pending_accept',
    assignedVendorId: null,
    ...overrides,
  }
}

function dashboard(rows: AdminWorkflowRow[]): AdminWorkflowDashboardData {
  const base = emptyAdminWorkflowDashboardData()
  return {
    ...base,
    escalated: rows.filter((row) => row.status === 'escalated'),
    maintenanceRuns: rows,
    runMetadata: Object.fromEntries(rows.map((row) => [row.id, {}])),
    stats: { ...base.stats, escalatedCount: rows.length },
  }
}

describe('shouldOmitEscalatedRunFromNeedsAttention', () => {
  it('omits escalated runs whose work order is completed on Active Tasks', () => {
    expect(
      shouldOmitEscalatedRunFromNeedsAttention({
        run: run({ id: 'run-1', vendorWorkStatus: 'completed' }),
        completedTicketIds: new Set(['ticket-1']),
      }),
    ).toBe(true)
  })

  it('omits runs that Active Tasks places in Completed from the last event', () => {
    expect(
      shouldOmitEscalatedRunFromNeedsAttention({
        run: run({
          id: 'run-2',
          vendorWorkStatus: null,
          assignedVendorId: null,
          lastEventType: 'maintenance.completed',
        }),
        completedTicketIds: new Set(),
      }),
    ).toBe(true)
  })

  it('omits a leftover escalated intake when the ticket is already completed', () => {
    expect(
      shouldOmitEscalatedRunFromNeedsAttention({
        run: run({
          id: 'intake-1',
          templateId: 'maintenance_intake',
          entityType: 'sms_conversation',
          entityId: 'convo-1',
          vendorWorkStatus: null,
        }),
        metadata: { draft_ticket_id: 'ticket-1' },
        completedTicketIds: new Set(['ticket-1']),
      }),
    ).toBe(true)
  })

  it('keeps open escalated repairs that still need a vendor', () => {
    expect(
      shouldOmitEscalatedRunFromNeedsAttention({
        run: run({ id: 'run-open' }),
        completedTicketIds: new Set(),
      }),
    ).toBe(false)
  })
})

describe('collectCompletedWorkOrderTicketIds', () => {
  it('includes tickets completed on the board even when another run is still escalated', () => {
    const ids = collectCompletedWorkOrderTicketIds({
      tickets: [{ id: 'ticket-1', vendorWorkStatus: 'completed' }],
      workflowData: dashboard([
        run({ id: 'run-1', vendorWorkStatus: 'completed', status: 'escalated' }),
      ]),
    })
    expect(ids.has('ticket-1')).toBe(true)
  })
})
