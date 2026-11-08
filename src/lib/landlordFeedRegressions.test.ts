import { describe, expect, it } from 'vitest'
import {
  estimateDeclinedFeedLine,
  fitFeedLine,
  landlordFeedLine,
  softRewriteFeedLine,
  vendorAlertFeedLine,
  vendorNoReplyFeedLine,
  withFeedScope,
} from '@/lib/landlordFeedCopy'
import {
  formatTimelineContextLine,
  selectLandlordFacingFeedEvents,
  type PropertyOperationsTimelineEvent,
} from '@/lib/propertyOperationsGraph'
import { looksLikeDiagnosticLandlordFeedCopy } from '@/lib/landlordFacingTimeline'

function feedEvent(
  overrides: Partial<PropertyOperationsTimelineEvent> &
    Pick<PropertyOperationsTimelineEvent, 'id' | 'eventType' | 'label'>,
): PropertyOperationsTimelineEvent {
  return {
    category: 'work_order',
    message: null,
    eventSource: 'automation',
    createdAt: '2026-11-05T18:00:00.000Z',
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

describe('Activity Feed regression fixtures', () => {
  it('never deletes words — only whole template variants', () => {
    const variants = ['Mike: no reply', 'No reply']
    const fitted = fitFeedLine(variants[0]!, variants.slice(1), [])
    expect(variants).toContain(fitted.line)
    expect(fitted.line.includes('…')).toBe(false)
    expect(fitted.line).not.toMatch(/\bwith no\b/)
  })

  it('rewrites mangled response-time and estimate lines', () => {
    expect(softRewriteFeedLine('Response time expired with no for Broken freezer door seal')).toBe(
      'No reply: freezer seal',
    )
    expect(softRewriteFeedLine('Estimate of $2.00 was not for Baseboard heater leak')).toBe(
      '$2.00 estimate declined',
    )
    expect(softRewriteFeedLine('Texted 1 requests that need a decision.')).toBe('Needs your decision')
  })

  it('uses complete estimate-declined and no-reply templates', () => {
    expect(
      estimateDeclinedFeedLine({
        amount: 2,
        issueHeadline: 'Baseboard heater leak',
        vendorName: 'Manny Plumber',
      }).line,
    ).toMatch(/Manny.*\$2 estimate declined/)
    expect(
      vendorNoReplyFeedLine({
        issueHeadline: 'Broken freezer door seal',
        vendorName: 'Mike',
      }).line,
    ).toBe('Mike: no reply')
    expect(
      vendorNoReplyFeedLine({
        issueHeadline: 'Broken freezer door seal',
      }).line,
    ).toBe('Vendor: no reply')
  })

  it('does not bolt for-issue onto punctuated sentences or show WO in the main line', () => {
    const scoped = withFeedScope(
      {
        line: 'The photo looked fine. No repair was opened.',
        full: 'The photo looked fine. No repair was opened.',
      },
      {
        workOrderRef: 'WO-6F38',
        issueHeadline: null,
        place: '78 Maple Ave',
      },
    )
    expect(scoped.line).toBe('The photo looked fine. No repair was opened.')
    expect(scoped.line).not.toMatch(/WO-6F38/)
    expect(scoped.full).toMatch(/WO-6F38/)
  })

  it('shortens issues and does not repeat the vendor on the context line', () => {
    expect(
      vendorAlertFeedLine({
        vendorName: 'Manny Plumber',
        issueHeadline: 'Baseboard heater leak',
        workOrderRef: 'WO-A6CA',
      }).line,
    ).toBe('Manny Plumber: heater leak')
    expect(
      formatTimelineContextLine(
        feedEvent({
          id: 'ctx',
          eventType: 'vendor.alert_sent',
          label: 'Manny Plumber: heater leak',
          fullLabel: 'Manny Plumber: heater leak',
          category: 'vendor',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          vendorName: 'Manny Plumber',
        }),
      ),
    ).toBe('78 Maple Ave · Unit 1')
  })

  it('hides diagnostic and raw event-name copy', () => {
    expect(looksLikeDiagnosticLandlordFeedCopy('maintenance open asks closed')).toBe(true)
    expect(
      looksLikeDiagnosticLandlordFeedCopy(
        'Unit/property FK audit found 0 ticket and 2 conversation mismatch(es). Run',
      ),
    ).toBe(true)
    expect(looksLikeDiagnosticLandlordFeedCopy('Auto-reassign repeated the same outcome')).toBe(true)
    expect(
      looksLikeDiagnosticLandlordFeedCopy(
        'Resident rent reply received while rent collection is paused.',
      ),
    ).toBe(true)
  })

  it('groups ticket rows into one story and waits once on the newest card', () => {
    const ticket = '074b0000-0000-4000-8000-000000000099'
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'alert-old',
          eventType: 'vendor.alert_sent',
          label: 'Sent Ecosafe a job',
          createdAt: '2026-11-03T12:00:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'Ecosafe',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'kitchen sink leak',
          metadata: {
            _feed_ticket: {
              spendStatus: 'pending_approval',
              recognizedSpendAmount: 240,
              vendorWorkStatus: 'accepted',
            },
          },
        }),
        feedEvent({
          id: 'accept-a',
          eventType: 'vendor.accepted',
          label: 'Ecosafe accepted',
          createdAt: '2026-11-04T12:00:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'Ecosafe',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'kitchen sink leak',
          metadata: {
            _feed_ticket: {
              spendStatus: 'pending_approval',
              recognizedSpendAmount: 240,
              vendorWorkStatus: 'accepted',
            },
          },
        }),
        feedEvent({
          id: 'accept-b',
          eventType: 'vendor.accepted',
          label: 'Ecosafe accepted the job',
          createdAt: '2026-11-04T12:02:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'Ecosafe',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'kitchen sink leak',
          metadata: {
            _feed_ticket: {
              spendStatus: 'pending_approval',
              recognizedSpendAmount: 240,
              vendorWorkStatus: 'accepted',
            },
          },
        }),
      ],
      10,
    )
    expect(selected).toHaveLength(1)
    expect(selected[0]?.id).toMatch(/^ticket-story:/)
    expect(selected[0]?.waitingHint).toBeFalsy()
    expect(selected[0]?.storySteps).toBeFalsy()
    expect(selected[0]?.label).toMatch(/Approve Ecosafe|Ulo /i)
    const milestones = selected[0]?.metadata?._feed_milestones as string[] | undefined
    expect(milestones?.join(' ')).toMatch(/Sent to Ecosafe/)
    expect(milestones?.filter((step) => /accepted/i.test(step))).toHaveLength(1)
  })

  it('does not surface open_asks_closed or FK audit rows', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'asks',
          eventType: 'maintenance.open_asks_closed',
          label: 'maintenance open asks closed',
          message: 'maintenance open asks closed for Pest control — exterminator requested',
          issueHeadline: 'Pest control — exterminator requested',
        }),
        feedEvent({
          id: 'fk',
          eventType: 'ops.ticket_unit_fk_mismatch',
          label: 'ops ticket unit fk mismatch',
          message: 'Unit/property FK audit found 0 ticket and 2 conversation mismatch(es). Run',
        }),
        feedEvent({
          id: 'keep',
          eventType: 'vendor.accepted',
          label: 'Vendor accepted the job',
          vendorName: 'Ecosafe',
          issueHeadline: 'kitchen sink leak',
          building: '78 Maple Ave',
        }),
      ],
      10,
    )
    expect(selected.map((row) => row.id)).toEqual(['keep'])
  })

  it('renders landlordFeedLine sentences without mid-word cuts for freezer/baseboard fixtures', () => {
    expect(
      landlordFeedLine({
        eventType: 'maintenance.sla_auto_reassigned',
        issueHeadline: 'Broken freezer door seal',
        vendorName: 'Mike',
        metadata: { outcome: 'needs_admin_vendor' },
      })?.line,
    ).toBe('Mike: no reply')
    expect(
      landlordFeedLine({
        eventType: 'maintenance.estimate_declined',
        issueHeadline: 'Baseboard heater leak',
        vendorName: 'Manny Plumber',
        metadata: { amount: 2 },
      })?.line,
    ).toBe("Manny Plumber's $2 estimate declined")
  })
})
