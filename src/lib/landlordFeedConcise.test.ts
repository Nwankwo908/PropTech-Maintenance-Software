import { describe, expect, it } from 'vitest'
import {
  FEED_LINE_MAX_WORDS,
  attentionAlertFeedLine,
  estimateDeclinedFeedLine,
  feedLineWordCount,
  inspectionCaptureFeedLine,
  landlordFeedLine,
  shortIssuePhrase,
  spendFeedLine,
  vendorAcceptedFeedLine,
  vendorAlertFeedLine,
  vendorNoReplyFeedLine,
} from '@/lib/landlordFeedCopy'
import {
  compactFeedTrailSteps,
  feedWaitingHint,
  formatTimelineContextLine,
  selectLandlordFacingFeedEvents,
  type PropertyOperationsTimelineEvent,
} from '@/lib/propertyOperationsGraph'

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

describe('concise Activity Feed copy contract', () => {
  it('shortens issues to 2–3 words', () => {
    expect(shortIssuePhrase('Broken freezer door seal')).toBe('freezer seal')
    expect(shortIssuePhrase('Baseboard heater leak')).toBe('heater leak')
    expect(shortIssuePhrase('Pest control — exterminator requested')).toBe('pest control')
    expect(shortIssuePhrase('Dryer fire')).toBe('dryer fire')
  })

  it('matches the target headline style', () => {
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: "NTA can't take this job",
        detail: 'Broken freezer door seal',
      })?.line,
    ).toBe('Pick a vendor for the freezer seal')
    expect(
      estimateDeclinedFeedLine({
        amount: 2,
        vendorName: 'Manny Plumber',
        issueHeadline: 'Baseboard heater leak',
      }).line,
    ).toBe("Manny Plumber's $2 estimate declined")
    expect(
      spendFeedLine({ amount: 2300, vendorName: 'Ecosafe Pest Management' })?.line,
    ).toBe('Ecosafe Pest Management invoice: $2,300')
    expect(
      attentionAlertFeedLine({
        kind: 'assign_vendor',
        headline: 'No preferred vendor matched',
        detail: 'Dryer fire in unit 3',
      })?.line,
    ).toMatch(/^⚠ Pick a vendor for the dryer fire$/i)
    expect(inspectionCaptureFeedLine({ phase: 'ended', outcome: 'looked fine' }).line).toBe(
      'Ulo checked the equipment scan: no issues',
    )
    expect(inspectionCaptureFeedLine({ phase: 'ended' }).line).toBe(
      'Ulo checked the equipment scan: no issues',
    )
    expect(
      vendorAlertFeedLine({
        vendorName: 'Manny Plumber',
        issueHeadline: 'Baseboard heater leak',
      }).line,
    ).toBe('Manny Plumber: heater leak')
    expect(vendorNoReplyFeedLine({ vendorName: 'NTA Services', issueHeadline: 'freezer seal' }).line).toBe(
      'NTA Services: no reply',
    )
    expect(
      vendorAcceptedFeedLine({ vendorName: 'Ecosafe', issueHeadline: 'kitchen sink leak' }).line,
    ).toBe('Ecosafe accepted: sink leak')
  })

  it('drops the waiting line — needs_you headlines already say the ask', () => {
    expect(
      feedWaitingHint(
        { eventType: 'landlord.attention_alert_sent', vendorName: null, residentName: null, metadata: null },
        { awaitingLandlordChoiceAt: '2026-11-05T12:00:00.000Z' },
      ),
    ).toBeNull()
    expect(
      feedWaitingHint(
        { eventType: 'maintenance.spend_recorded', vendorName: 'Ecosafe', residentName: null, metadata: null },
        { spendStatus: 'pending_approval', recognizedSpendAmount: 2300 },
      ),
    ).toBeNull()
    expect(
      feedWaitingHint(
        { eventType: 'vendor.alert_sent', vendorName: 'Ecosafe', residentName: null, metadata: null },
        { vendorWorkStatus: 'pending_accept' },
      ),
    ).toBeNull()
  })

  it('enforces headline ≤8, waiting ≤5, trail ≤3 steps of ≤3 words', () => {
    const ticket = '074b0000-0000-4000-8000-000000000044'
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'a',
          eventType: 'vendor.alert_sent',
          label: 'Sent',
          createdAt: '2026-11-01T12:00:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'NTA Services',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Broken freezer door seal',
        }),
        feedEvent({
          id: 'b',
          eventType: 'maintenance.sla_auto_reassigned',
          label: 'No reply',
          createdAt: '2026-11-02T12:00:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'NTA Services',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Broken freezer door seal',
          metadata: { outcome: 'needs_admin_vendor' },
        }),
        feedEvent({
          id: 'c',
          eventType: 'landlord.attention_alert_sent',
          label: 'Pick',
          createdAt: '2026-11-03T12:00:00.000Z',
          maintenanceRequestId: ticket,
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Broken freezer door seal',
          metadata: {
            kind: 'assign_vendor',
            headline: "NTA can't take this job",
            detail: 'Broken freezer door seal',
            _feed_ticket: { awaitingLandlordChoiceAt: '2026-11-03T12:00:00.000Z' },
          },
        }),
        feedEvent({
          id: 'd',
          eventType: 'vendor.alert_sent',
          label: 'Resent',
          createdAt: '2026-11-03T13:00:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'Mike',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Broken freezer door seal',
          metadata: {
            _feed_ticket: { awaitingLandlordChoiceAt: '2026-11-03T12:00:00.000Z' },
          },
        }),
        feedEvent({
          id: 'e',
          eventType: 'maintenance.sla_auto_reassigned',
          label: 'Again',
          createdAt: '2026-11-04T12:00:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'Mike',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Broken freezer door seal',
          metadata: {
            outcome: 'needs_admin_vendor',
            _feed_ticket: { awaitingLandlordChoiceAt: '2026-11-03T12:00:00.000Z' },
          },
        }),
      ],
      10,
    )
    expect(selected).toHaveLength(1)
    const row = selected[0]!
    expect(feedLineWordCount(row.label)).toBeLessThanOrEqual(14)
    expect(row.label).not.toMatch(/\bthe job\b/i)
    expect(row.label).not.toMatch(/\bat 78 Maple\b/i)
    expect(row.label).not.toMatch(/\bRepair\b/)
    expect(formatTimelineContextLine(row)).toBe('78 Maple Ave · Unit 1')
    expect(row.waitingHint).toBeFalsy()
    expect(row.storySteps).toBeFalsy()
    expect(row.label).not.toMatch(/→/)
    const milestones = row.metadata?._feed_milestones as string[] | undefined
    expect(milestones?.length).toBeGreaterThan(0)
    expect(milestones!.length).toBeLessThanOrEqual(3)
  })

  it('keeps compactFeedTrailSteps helper for detail history (cards no longer render trails)', () => {
    expect(compactFeedTrailSteps(['Sent to NTA', 'No reply', 'Asked you', 'Resent', 'No reply'])).toEqual([
      'Sent to NTA',
      'No reply',
      '+3',
    ])
    expect(compactFeedTrailSteps(['Accepted', 'Work done'])).toEqual(['Accepted', 'Work done'])
  })

  it('keeps every landlordFeedLine headline within the 8-word budget', () => {
    const samples = [
      landlordFeedLine({
        eventType: 'maintenance.sla_auto_reassigned',
        issueHeadline: 'Broken freezer door seal',
        vendorName: 'Mike',
        metadata: { outcome: 'needs_admin_vendor' },
      }),
      landlordFeedLine({
        eventType: 'maintenance.estimate_declined',
        issueHeadline: 'Baseboard heater leak',
        vendorName: 'Manny Plumber',
        metadata: { amount: 2 },
      }),
      landlordFeedLine({
        eventType: 'maintenance.spend_recorded',
        vendorName: 'Ecosafe',
        metadata: { total_cost: 2300 },
      }),
      landlordFeedLine({
        eventType: 'inspection.capture_session_ended',
        building: '78 Maple Ave',
      }),
    ]
    for (const line of samples) {
      expect(line).toBeTruthy()
      expect(feedLineWordCount(line!.line)).toBeLessThanOrEqual(FEED_LINE_MAX_WORDS)
      expect(line!.line.includes('…')).toBe(false)
      expect(line!.line).not.toMatch(/\bthe job\b/i)
    }
  })
})
