import { describe, expect, it } from 'vitest'
import {
  insightWorkOrderHref,
  pickWorkflowRunIdForTicket,
} from './insightWorkOrderDestination'

const ticketId = '11111111-1111-4111-8111-111111111111'

describe('insight work order destination', () => {
  it('opens the Active Tasks work order for a linked run', () => {
    const runId = pickWorkflowRunIdForTicket(
      [
        {
          id: 'intake-run',
          templateId: 'maintenance_intake',
          entityType: 'sms_conversation',
          entityId: 'conversation-1',
          metadata: { draft_ticket_id: ticketId },
        },
        {
          id: 'request-run',
          templateId: 'maintenance_request',
          entityType: 'maintenance_request',
          entityId: ticketId,
        },
      ],
      ticketId,
    )
    expect(runId).toBe('request-run')
    expect(insightWorkOrderHref({ runId, ticketId })).toBe('/admin/workflows?run=request-run')
  })

  it('uses intake metadata when that is the only link to the ticket', () => {
    const runId = pickWorkflowRunIdForTicket(
      [
        {
          id: 'intake-run',
          templateId: 'maintenance_intake',
          entityType: 'sms_conversation',
          entityId: 'conversation-1',
        },
      ],
      ticketId,
      { 'intake-run': { maintenance_request_id: ticketId } },
    )
    expect(insightWorkOrderHref({ runId, ticketId })).toBe('/admin/workflows?run=intake-run')
  })

  it('opens the maintenance request when no workflow run exists', () => {
    expect(pickWorkflowRunIdForTicket([], ticketId)).toBeNull()
    expect(insightWorkOrderHref({ ticketId })).toBe(
      `/admin/requests?request=${encodeURIComponent(ticketId)}`,
    )
  })
})
