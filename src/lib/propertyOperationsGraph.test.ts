import { describe, expect, it } from 'vitest'
import {
  categorizePropertyOperationsEvent,
  dedupePropertyOperationsEvents,
  formatTimelineContextLine,
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

  it('hides activation-alert bookkeeping and keeps action required', () => {
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({
          id: '10',
          eventType: 'tenant.activation_failure_resolved',
          label: 'tenant activation failure resolved',
          message: 'Activation failure resolved (activated).',
        }),
      ),
    ).toBe(false)
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({
          id: '11',
          eventType: 'tenant.activation_action_required',
          label: 'Welcome text could not be delivered',
        }),
      ),
    ).toBe(true)
    expect(
      isLandlordFacingFeedEvent(
        feedEvent({
          id: '12',
          eventType: 'rent.collection_cron_triggered',
          label: 'rent collection cron triggered',
        }),
      ),
    ).toBe(false)
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

  it('hides activation-alert bookkeeping so internal reason codes stay off Overview', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'onboard-sent',
          eventType: 'tenant.activation_sms_sent',
          label: 'Welcome text sent',
          createdAt: '2026-08-15T10:00:00.000Z',
          residentId: 'res-1',
          residentName: 'Saad Iqbal',
        }),
        feedEvent({
          id: 'onboard-done',
          eventType: 'tenant.activation_completed',
          label: 'Resident activated',
          createdAt: '2026-08-15T10:03:00.000Z',
          residentId: 'res-1',
          residentName: 'Saad Iqbal',
        }),
        feedEvent({
          id: 'resolve-1',
          eventType: 'tenant.activation_failure_resolved',
          label: 'tenant activation failure resolved',
          message: 'Activation failure resolved (activated).',
          createdAt: '2026-08-15T10:03:01.000Z',
          residentId: 'res-1',
          residentName: 'Saad Iqbal',
        }),
        feedEvent({
          id: 'resolve-2',
          eventType: 'tenant.activation_failure_resolved',
          label: 'tenant activation failure resolved',
          message: 'Activation failure resolved (activated).',
          createdAt: '2026-08-15T10:03:02.000Z',
        }),
      ],
      8,
    )

    expect(selected).toHaveLength(1)
    expect(selected[0]?.eventType).toBe('tenant.onboarding_verification')
    expect(selected.map((event) => event.label).join(' ')).not.toMatch(/\(activated\)/)
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

  it('shows one Ask Ulo answer when both activity tables carry the same line', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'overview-row',
          eventType: 'ask_ulo.answered',
          label: 'ask ulo answered',
          category: 'admin',
          message: 'Ulo answered: What indoor temperature is recorded?',
          eventSource: 'edge_function',
          createdAt: '2026-10-29T22:40:00.000Z',
        }),
        feedEvent({
          id: 'primary-row',
          eventType: 'ask_ulo.answered',
          label: 'ask ulo answered',
          category: 'admin',
          message: 'Ulo answered: What indoor temperature is recorded?',
          eventSource: 'edge_function',
          createdAt: '2026-10-29T22:40:01.000Z',
        }),
      ],
      8,
    )

    expect(selected).toHaveLength(1)
    expect(selected[0]?.label).toBe('Ulo answered: What indoor temperature is recorded?')
    expect(selected[0]?.label).not.toMatch(/eval|gpt-|workflow/i)
  })

  it('shows one uploaded-document line and hides the second copy', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'overview-doc',
          eventType: 'document.text_saved',
          label: 'document text saved',
          category: 'admin',
          message: 'Uploaded document ready to review: qa-lease.pdf.',
          eventSource: 'edge_function',
          createdAt: '2026-10-29T23:10:00.000Z',
        }),
        feedEvent({
          id: 'primary-doc',
          eventType: 'document.text_saved',
          label: 'document text saved',
          category: 'admin',
          message: 'Uploaded document ready to review: qa-lease.pdf.',
          eventSource: 'edge_function',
          createdAt: '2026-10-29T23:10:01.000Z',
        }),
      ],
      8,
    )

    expect(selected).toHaveLength(1)
    expect(selected[0]?.label).toBe('Uploaded document ready to review: qa-lease.pdf.')
    expect(selected[0]?.label).not.toMatch(/text_saved|extracted/i)
  })

  it('limits the feed to the current onboarding session while setup is in progress', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'old',
          eventType: 'residents.imported',
          label: 'Imported residents',
          createdAt: '2026-09-20T16:24:00.000Z',
        }),
        feedEvent({
          id: 'cron',
          eventType: 'rent.collection_cron_triggered',
          label: 'rent collection cron triggered',
          createdAt: '2026-09-25T21:01:00.000Z',
        }),
        feedEvent({
          id: 'new',
          eventType: 'residents.imported',
          label: 'Imported residents',
          createdAt: '2026-09-25T21:05:00.000Z',
          onboardingSessionId: 'sess-1',
        }),
      ],
      8,
      {
        onboardingSession: {
          onboardingSessionId: 'sess-1',
          onboardingSessionStartedAt: '2026-09-25T21:00:00.000Z',
        },
      },
    )

    expect(selected.map((event) => event.id)).toEqual(['new'])
  })
})

describe('landlord activity feed cleanup', () => {
  it('keeps one richer row when the same event is stored twice', () => {
    const plain = feedEvent({
      id: 'plain',
      eventType: 'vendor.alert_sent',
      label: 'vendor alert sent',
      createdAt: '2026-10-21T12:00:00.000Z',
      maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
      message: 'Sent',
    })
    const rich = feedEvent({
      id: 'rich',
      eventType: 'vendor.alert_sent',
      label: 'vendor alert sent',
      createdAt: '2026-10-21T12:00:02.000Z',
      maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
      message: 'Sent',
      building: '123 Main',
      vendorName: 'Ecosafe',
    })
    const deduped = dedupePropertyOperationsEvents([plain, rich])
    expect(deduped).toHaveLength(1)
    expect(deduped[0]?.vendorName).toBe('Ecosafe')
    expect(deduped[0]?.building).toBe('123 Main')
  })

  it('hides internal notes that remain in the input', () => {
    const raw = [
      feedEvent({
        id: 'suppressed',
        eventType: 'automation.message_suppressed',
        label: 'automation message suppressed',
        message: 'Suppressed automated schedule_fsm_ttl_tenant_confirm: referenced_instant_past.',
      }),
      feedEvent({
        id: 'unmapped',
        eventType: 'maintenance.terminate_reason_unmapped',
        label: 'maintenance terminate reason unmapped',
        message: 'Cancel reason needs vendor-safe copy: "internal_cleanup_code".',
      }),
    ]
    expect(raw).toHaveLength(2)
    expect(selectLandlordFacingFeedEvents(raw, 10)).toEqual([])
  })

  it('merges a cancellation and its raw reason into one safe row', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'cancel',
          eventType: 'maintenance.work_order_terminated',
          label: 'maintenance work order terminated',
          message: 'WO-C18B was cancelled (an automated cleanup).',
          createdAt: '2026-10-21T12:05:00.000Z',
          maintenanceRequestId: 'c18b0000-0000-4000-8000-000000000001',
          metadata: { reason: 'internal_cleanup_token_value' },
        }),
        feedEvent({
          id: 'reason',
          eventType: 'maintenance.terminate_reason_unmapped',
          label: 'maintenance terminate reason unmapped',
          message: 'Cancel reason needs vendor-safe copy: "Home Check note was opened as a repair by mistake".',
          createdAt: '2026-10-21T12:05:01.000Z',
          maintenanceRequestId: 'c18b0000-0000-4000-8000-000000000001',
          metadata: { reason: 'Home Check note was opened as a repair by mistake' },
        }),
      ],
      10,
    )
    expect(selected).toHaveLength(1)
    expect(selected[0]?.label).toBe('WO-C18B closed: Home Check note, not a repair')
    expect(selected[0]?.fullLabel).toBe(selected[0]?.label)
    expect(selected[0]?.message ?? '').not.toMatch(/vendor-safe|internal_cleanup/)
    expect(selected[0]?.label).not.toMatch(/vendor-safe|internal_cleanup/)
  })

  it('says who accepted which work order', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'reply',
          eventType: 'vendor.replied',
          label: 'vendor replied',
          vendorName: 'Ecosafe',
          maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
          metadata: { parsed_action: 'accept' },
        }),
      ],
      5,
    )
    expect(selected[0]?.label).toBe('Ecosafe accepted WO-074B')
    expect(selected[0]?.category).toBe('vendor')
  })

  it('includes the amount and work order on a spend row', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'spend',
          eventType: 'maintenance.spend_recorded',
          label: 'maintenance spend recorded',
          vendorName: 'Ecosafe',
          maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
          metadata: { total_cost: 2300 },
        }),
      ],
      5,
    )
    expect(selected[0]?.label).toBe('$2,300 spent on WO-074B (Ecosafe)')
    expect(selected[0]?.category).toBe('spend')
  })

  it('maps each event family and keeps system events out of Admin', () => {
    const cases: Array<[string, string, string]> = [
      ['maintenance.spend_recorded', 'automation', 'spend'],
      ['maintenance.estimate_submitted', 'edge_function', 'spend'],
      ['vendor.alert_sent', 'edge_function', 'vendor'],
      ['vendor.replied', 'sms', 'vendor'],
      ['vendor.accepted', 'sms', 'vendor'],
      ['vendor.declined', 'sms', 'vendor'],
      ['maintenance.schedule_fsm_ttl_expired', 'automation', 'scheduling'],
      ['maintenance.schedule_confirmed', 'sms', 'scheduling'],
      ['maintenance.created', 'sms', 'work_order'],
      ['maintenance.work_order_terminated', 'automation', 'work_order'],
      ['maintenance.completed', 'dashboard', 'work_order'],
      ['inspection.serial_read', 'edge_function', 'equipment'],
      ['inspection.completed', 'edge_function', 'inspection'],
      ['tenant.activation_sms_sent', 'sms', 'tenant'],
      ['sms.delivery_failed', 'sms', 'tenant'],
      ['rent.reminder_sent', 'automation', 'rent'],
      ['move_in.checklist_sent', 'automation', 'move_in'],
      ['move_out.started', 'automation', 'move_out'],
      ['broadcast.sent', 'dashboard', 'admin'],
      ['ask_ulo.answered', 'edge_function', 'admin'],
      ['document.text_saved', 'edge_function', 'admin'],
      ['automation.message_suppressed', 'automation', 'work_order'],
    ]
    for (const [eventType, source, category] of cases) {
      expect(categorizePropertyOperationsEvent(eventType, source)).toBe(category)
    }
    expect(categorizePropertyOperationsEvent('automation.message_suppressed', 'automation')).not.toBe('admin')
    expect(categorizePropertyOperationsEvent('maintenance.schedule_fsm_ttl_expired', 'automation')).not.toBe('admin')
    expect(categorizePropertyOperationsEvent('workflow.escalate', 'edge_function')).not.toBe('admin')
  })

  it('names one person next to the address', () => {
    expect(
      formatTimelineContextLine(
        feedEvent({
          id: 'row',
          eventType: 'vendor.alert_sent',
          label: 'Sent WO-074B to Ecosafe.',
          category: 'vendor',
          building: '123 Main',
          residentName: 'LA2 SMS Journey Tenant',
          vendorName: 'Ecosafe',
        }),
      ),
    ).toBe('123 Main · Ecosafe')
  })

  it('turns a 19-row sample into the eight landlord stories', () => {
    const at = (minute: number, second = 0) =>
      `2026-10-21T18:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`
    const ticket = '074b0000-0000-4000-8000-000000000001'
    const cancelTicket = 'c18b0000-0000-4000-8000-000000000001'
    const pair = (
      id: string,
      eventType: string,
      label: string,
      minute: number,
      extra: Partial<PropertyOperationsTimelineEvent> = {},
    ) => [
      feedEvent({
        id: `${id}-plain`,
        eventType,
        label,
        createdAt: at(minute, 0),
        maintenanceRequestId: extra.maintenanceRequestId ?? ticket,
        ...extra,
        building: null,
        vendorName: null,
        residentName: null,
      }),
      feedEvent({
        id: `${id}-rich`,
        eventType,
        label,
        createdAt: at(minute, 2),
        building: '123 Main',
        vendorName: 'Ecosafe',
        residentName: 'LA2 SMS Journey Tenant',
        maintenanceRequestId: extra.maintenanceRequestId ?? ticket,
        ...extra,
      }),
    ]
    const input = [
      ...pair('opened', 'maintenance.created', 'Work order opened', 1),
      ...pair('alert', 'vendor.alert_sent', 'vendor alert sent', 2),
      ...pair('accept', 'vendor.replied', 'vendor replied', 3, {
        metadata: { parsed_action: 'accept' },
      }),
      ...pair('spend', 'maintenance.spend_recorded', 'maintenance spend recorded', 4, {
        metadata: { total_cost: 2300 },
      }),
      ...pair('serial', 'inspection.serial_read', 'inspection serial read', 5, {
        message: 'Serial number read: X132753655.',
        metadata: { appliance: 'Water heater', serial: 'X132753655' },
        maintenanceRequestId: null,
      }),
      ...pair('cancel', 'maintenance.work_order_terminated', 'maintenance work order terminated', 6, {
        message: 'WO-C18B was cancelled (an automated cleanup).',
        maintenanceRequestId: cancelTicket,
        metadata: { reason: 'internal_cleanup_token_value' },
      }),
      feedEvent({
        id: 'reason',
        eventType: 'maintenance.terminate_reason_unmapped',
        label: 'maintenance terminate reason unmapped',
        message: 'Cancel reason needs vendor-safe copy: "Home Check note was opened as a repair by mistake".',
        createdAt: at(6, 1),
        maintenanceRequestId: cancelTicket,
        metadata: { reason: 'Home Check note was opened as a repair by mistake' },
      }),
      ...pair('ttl', 'maintenance.schedule_fsm_ttl_expired', 'maintenance schedule fsm ttl expired', 7, {
        metadata: { effect: 'quiet_expire_past_window' },
      }),
      feedEvent({
        id: 'suppressed',
        eventType: 'automation.message_suppressed',
        label: 'automation message suppressed',
        message: 'Suppressed automated schedule_fsm_ttl_tenant_confirm: referenced_instant_past.',
        createdAt: at(7, 1),
        maintenanceRequestId: ticket,
      }),
      ...pair('decline', 'vendor.replied', 'vendor replied', 9, {
        metadata: { parsed_action: 'decline' },
      }),
      feedEvent({
        id: 'plumbing',
        eventType: 'workflow.act',
        label: 'Action taken',
        createdAt: at(10, 0),
      }),
    ]
    expect(input).toHaveLength(19)
    const selected = selectLandlordFacingFeedEvents(input, 20)
    expect(selected).toHaveLength(8)
    expect(selected.map((event) => event.label)).toEqual([
      'Ecosafe declined WO-074B; finding another vendor',
      'WO-074B visit window passed without tenant confirmation; no texts sent',
      'WO-C18B closed: Home Check note, not a repair',
      'Water heater serial X132753655 recorded',
      '$2,300 spent on WO-074B (Ecosafe)',
      'Ecosafe accepted WO-074B',
      'Sent WO-074B to Ecosafe',
      'Work order opened',
    ])
    for (const event of selected) {
      expect(event.label.length).toBeLessThanOrEqual(85)
      expect(event.label.trim().split(/\s+/).length).toBeLessThanOrEqual(14)
      expect(event.fullLabel).toContain(event.label.replace(/…$/, ''))
    }
    expect(selected.map((event) => event.category)).toEqual([
      'vendor',
      'scheduling',
      'work_order',
      'equipment',
      'spend',
      'vendor',
      'vendor',
      'work_order',
    ])
    expect(selected.map((event) => event.label).join('\n')).not.toMatch(
      /schedule_fsm|Suppressed|vendor-safe|TTL|FSM/,
    )
    for (const event of selected) {
      const line = formatTimelineContextLine(event) ?? ''
      expect(line.split(' · ').length).toBeLessThanOrEqual(2)
      if (event.category === 'vendor' || event.category === 'spend') {
        expect(line).toBe('123 Main · Ecosafe')
      }
    }
  })
})
