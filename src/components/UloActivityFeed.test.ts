import { describe, expect, it } from 'vitest'
import {
  activityFeedNavigatePath,
  feedEventOpenTarget,
  feedEventTicketId,
  splitFeedLabelForWorkOrderLinks,
} from '@/components/UloActivityFeed'
import type { PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'

function event(
  overrides: Partial<PropertyOperationsTimelineEvent>,
): PropertyOperationsTimelineEvent {
  return {
    id: '1',
    eventType: 'landlord.attention_alert_sent',
    label: 'Asked you to pick a vendor',
    category: 'admin',
    message: null,
    eventSource: 'automation',
    createdAt: new Date().toISOString(),
    scheduledAt: null,
    unitLabel: null,
    building: '14 Maple Ave',
    residentId: null,
    residentName: null,
    vendorName: null,
    maintenanceRequestId: null,
    workflowRunId: null,
    onboardingSessionId: null,
    metadata: null,
    ...overrides,
  }
}

describe('Ulo activity feed navigation', () => {
  it('prefers ticket deep-link over a stale workflow run id', () => {
    const target = feedEventOpenTarget(
      event({
        maintenanceRequestId: 'a1b20000-0000-4000-8000-000000000001',
        workflowRunId: 'dead-run-id',
      }),
      new Map(),
    )
    expect(target).toEqual({
      kind: 'ticket',
      ticketId: 'a1b20000-0000-4000-8000-000000000001',
    })
    expect(activityFeedNavigatePath(target!)).toBe(
      '/admin/workflows?ticket=a1b20000-0000-4000-8000-000000000001',
    )
  })

  it('falls back to workflow run when no ticket is linked', () => {
    const target = feedEventOpenTarget(
      event({ workflowRunId: 'run-123' }),
      new Map(),
    )
    expect(target).toEqual({ kind: 'workflow', runId: 'run-123' })
    expect(activityFeedNavigatePath(target!)).toBe('/admin/workflows?run=run-123')
  })

  it('returns null when there is nowhere useful to go', () => {
    expect(feedEventOpenTarget(event({}), new Map())).toBeNull()
  })

  it('resolves ticket ids from metadata when the column is empty', () => {
    expect(
      feedEventTicketId(
        event({
          maintenanceRequestId: null,
          metadata: { maintenance_request_id: 'a1b20000-0000-4000-8000-000000000001' },
        }),
      ),
    ).toBe('a1b20000-0000-4000-8000-000000000001')
    expect(
      feedEventOpenTarget(
        event({
          label: 'Ecosafe accepted WO-A1B2',
          metadata: { maintenance_request_id: 'a1b20000-0000-4000-8000-000000000001' },
        }),
        new Map(),
      ),
    ).toEqual({
      kind: 'ticket',
      ticketId: 'a1b20000-0000-4000-8000-000000000001',
    })
  })

  it('splits WO refs out of feed labels for links', () => {
    expect(splitFeedLabelForWorkOrderLinks('Ecosafe accepted WO-074B at 14 Maple')).toEqual([
      { text: 'Ecosafe accepted ', workOrder: false },
      { text: 'WO-074B', workOrder: true },
      { text: ' at 14 Maple', workOrder: false },
    ])
  })
})
