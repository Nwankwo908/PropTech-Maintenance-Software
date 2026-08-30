import { describe, expect, it } from 'vitest'
import {
  isLandlordFacingFeedEvent,
  selectLandlordFacingFeedEvents,
  type PropertyOperationsTimelineEvent,
} from './propertyOperationsGraph'

function feedEvent(
  overrides: Partial<PropertyOperationsTimelineEvent> &
    Pick<PropertyOperationsTimelineEvent, 'id' | 'eventType' | 'label'>,
): PropertyOperationsTimelineEvent {
  return {
    category: 'admin',
    message: null,
    eventSource: 'sms',
    createdAt: '2026-08-15T12:00:00.000Z',
    scheduledAt: null,
    unitLabel: null,
    building: null,
    residentId: null,
    residentName: null,
    vendorName: null,
    maintenanceRequestId: null,
    workflowRunId: null,
    ...overrides,
  }
}

describe('isLandlordFacingFeedEvent', () => {
  it('hides workflow pipeline receipts', () => {
    expect(
      isLandlordFacingFeedEvent(feedEvent({ id: '1', eventType: 'workflow.act', label: 'Action taken' })),
    ).toBe(false)
    expect(
      isLandlordFacingFeedEvent(feedEvent({ id: '2', eventType: 'workflow.log', label: 'Logged' })),
    ).toBe(false)
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({ id: '3', eventType: 'workflow.trigger', label: 'Workflow started' }),
      ),
    ).toBe(false)
  })

  it('hides raw SMS delivery and receive receipts', () => {
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({
          id: '4',
          eventType: 'sms.delivered',
          label: 'sms delivered',
          maintenanceRequestId: 'ticket-1',
          residentName: 'Saad Iqbal',
        }),
      ),
    ).toBe(false)
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({
          id: '5',
          eventType: 'sms.message_received',
          label: 'sms message received',
          maintenanceRequestId: 'ticket-1',
        }),
      ),
    ).toBe(false)
  })

  it('keeps outcome events and escalations', () => {
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({ id: '6', eventType: 'maintenance.created', label: 'Work order opened' }),
      ),
    ).toBe(true)
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({ id: '7', eventType: 'vendor.accepted', label: 'Vendor accepted the job' }),
      ),
    ).toBe(true)
    expect(
      isLandlordFacingFeedEvent(feedEvent({ id: '8', eventType: 'workflow.escalate', label: 'Escalated' })),
    ).toBe(true)
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({ id: '9', eventType: 'sms.delivery_failed', label: 'Text could not be delivered' }),
      ),
    ).toBe(true)
  })

  it('keeps collapsed tenant onboarding cards even when the latest type was a receipt', () => {
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({
          id: 'tenant-onboarding:res-1:2026-08-15',
          eventType: 'sms.delivered',
          label: 'Tenant onboarding verification',
        }),
      ),
    ).toBe(true)
  })
})

describe('selectLandlordFacingFeedEvents', () => {
  it('drops pipeline and SMS transport lines so the feed fills with outcomes', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'noise-act',
          eventType: 'workflow.act',
          label: 'Action taken',
          createdAt: '2026-08-15T12:05:00.000Z',
          residentName: 'Saad Iqbal',
        }),
        feedEvent({
          id: 'noise-sms',
          eventType: 'sms.delivered',
          label: 'sms delivered',
          createdAt: '2026-08-15T12:04:00.000Z',
          maintenanceRequestId: 'ticket-1',
        }),
        feedEvent({
          id: 'outcome',
          eventType: 'maintenance.created',
          label: 'Work order opened',
          createdAt: '2026-08-15T12:03:00.000Z',
        }),
        feedEvent({
          id: 'noise-log',
          eventType: 'workflow.log',
          label: 'Logged',
          createdAt: '2026-08-15T12:02:00.000Z',
        }),
        feedEvent({
          id: 'accepted',
          eventType: 'vendor.accepted',
          label: 'Vendor accepted the job',
          createdAt: '2026-08-15T12:01:00.000Z',
        }),
      ],
      8,
    )

    expect(selected.map((event) => event.eventType)).toEqual([
      'maintenance.created',
      'vendor.accepted',
    ])
  })

  it('collapses tenant onboarding receipts into one card and hides a lone delivery receipt', () => {
    const collapsed = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'sent',
          eventType: 'tenant.activation_sms_sent',
          label: 'Welcome text sent',
          createdAt: '2026-08-15T10:00:00.000Z',
          residentId: 'res-1',
          residentName: 'Saad Iqbal',
        }),
        feedEvent({
          id: 'delivered',
          eventType: 'sms.delivered',
          label: 'sms delivered',
          createdAt: '2026-08-15T10:01:00.000Z',
          residentId: 'res-1',
        }),
        feedEvent({
          id: 'replied',
          eventType: 'sms.message_received',
          label: 'sms message received',
          createdAt: '2026-08-15T10:02:00.000Z',
          residentId: 'res-1',
        }),
        feedEvent({
          id: 'opted-in',
          eventType: 'tenant.sms_opted_in',
          label: 'Resident opted in to texts',
          createdAt: '2026-08-15T10:03:00.000Z',
          residentId: 'res-1',
        }),
      ],
      8,
    )

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.eventType).toBe('tenant.onboarding_verification')
    expect(collapsed[0]?.label).toBe('Tenant onboarding verification')
    expect(collapsed[0]?.message).toContain('welcome text sent')
    expect(collapsed[0]?.message).toContain('opted in')

    const loneReceipt = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'only-delivered',
          eventType: 'sms.delivered',
          label: 'sms delivered',
          createdAt: '2026-08-15T11:00:00.000Z',
          residentId: 'res-2',
        }),
      ],
      8,
    )
    expect(loneReceipt).toEqual([])
  })

  it('uses a stored message when the type label is just the raw event name', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'custom',
          eventType: 'ask_ulo.note_saved',
          label: 'ask ulo note saved',
          message: 'Saad texted a repair for the kitchen sink.',
          createdAt: '2026-08-15T09:00:00.000Z',
        }),
      ],
      8,
    )

    expect(selected).toHaveLength(1)
    expect(selected[0]?.label).toBe('Saad texted a repair for the kitchen sink.')
  })
})
