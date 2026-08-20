import { describe, expect, it } from 'vitest'
import {
  isCancelledOnActiveTasks,
  isCompletedOnActiveTasks,
  maintenanceTicketIdFromWorkflowRun,
} from './adminWorkflows'

describe('maintenanceTicketIdFromWorkflowRun', () => {
  it('uses the entity id when the run already targets a ticket', () => {
    expect(
      maintenanceTicketIdFromWorkflowRun({
        templateId: 'maintenance_request',
        entityType: 'maintenance_request',
        entityId: 'ticket-1',
        metadata: {},
      }),
    ).toBe('ticket-1')
  })

  it('falls back to intake draft_ticket_id when the run is conversation-keyed', () => {
    expect(
      maintenanceTicketIdFromWorkflowRun({
        templateId: 'maintenance_intake',
        entityType: 'sms_conversation',
        entityId: 'convo-1',
        metadata: { draft_ticket_id: 'ticket-draft' },
      }),
    ).toBe('ticket-draft')
  })
})

describe('isCancelledOnActiveTasks', () => {
  it('hides runs whose workflow status is cancelled', () => {
    expect(isCancelledOnActiveTasks({ status: 'cancelled', vendorWorkStatus: 'unassigned' })).toBe(
      true,
    )
  })

  it('hides still-active runs whose work order was cancelled over SMS', () => {
    expect(isCancelledOnActiveTasks({ status: 'active', vendorWorkStatus: 'cancelled' })).toBe(true)
  })

  it('keeps open repairs on the board', () => {
    expect(isCancelledOnActiveTasks({ status: 'active', vendorWorkStatus: 'pending_accept' })).toBe(
      false,
    )
  })
})

describe('isCompletedOnActiveTasks', () => {
  it('treats vendor-completed jobs as settled even when the run is still escalated', () => {
    expect(
      isCompletedOnActiveTasks({ status: 'escalated', vendorWorkStatus: 'completed' }),
    ).toBe(true)
  })

  it('keeps escalated jobs that are not finished', () => {
    expect(
      isCompletedOnActiveTasks({ status: 'escalated', vendorWorkStatus: 'pending_accept' }),
    ).toBe(false)
  })
})
