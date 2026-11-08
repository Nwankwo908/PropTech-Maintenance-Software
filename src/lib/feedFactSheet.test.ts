import { describe, expect, it } from 'vitest'
import {
  buildFeedFactSheet,
  fallbackFeedCardCopy,
  feedFactsHash,
  nonJobFeedCardCopy,
  shortIssueForFacts,
  shortVendorForFacts,
  validateFeedCardCopy,
  type FeedFactSheet,
} from '@shared/activityFeed/feedFactSheet'
import { selectLandlordFacingFeedEvents, type PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'

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

describe('feedFactSheet fixtures', () => {
  it('shortens issues to 2–4 words and never uses the vendor as the issue', () => {
    expect(shortIssueForFacts('Broken freezer door seal', 'NTA Handyman Services')).toMatch(
      /freezer|seal/i,
    )
    expect(shortIssueForFacts('Broken freezer door seal', 'NTA Handyman Services')).not.toMatch(
      /NTA|Handyman/i,
    )
    expect(shortIssueForFacts('Dryer caught fire', null)).toMatch(/Dryer fire|Dryer/i)
    expect(shortVendorForFacts('NTA Handyman Services')).toBe('NTA')
    expect(shortVendorForFacts('Ecosafe Pest Control')).toBe('Ecosafe')
  })

  it('never puts raw event names or truncated names in the fact sheet', () => {
    const facts = buildFeedFactSheet(
      {
        issueHeadline: 'Broken freezer door seal',
        building: '78 Maple Ave',
        unitLabel: '1',
        vendorName: 'NTA Handyman Services',
        awaitingLandlordChoiceAt: '2026-11-03T12:00:00.000Z',
      },
      [
        {
          eventType: 'maintenance.classified',
          label: 'MAINTENANCE CLASSIFIED',
          createdAt: '2026-11-01T12:00:00.000Z',
        },
        {
          eventType: 'maintenance.vendor_availability_probed',
          label: 'maintenance vendor availability probed: caught fire',
          createdAt: '2026-11-02T12:00:00.000Z',
        },
        {
          eventType: 'vendor.alert_sent',
          vendorName: 'NTA Handyman Services',
          createdAt: '2026-11-03T12:00:00.000Z',
        },
        {
          eventType: 'maintenance.sla_auto_reassigned',
          createdAt: '2026-11-04T12:00:00.000Z',
        },
      ],
    )
    expect(facts.issue).toMatch(/Freezer|Seal/i)
    expect(facts.issue).not.toMatch(/NTA|Handyman/i)
    expect(facts.property).toBe('78 Maple Ave')
    expect(facts.unit).toBe('1')
    expect(facts.vendor).toBe('NTA')
    expect(facts.milestones.join(' ')).not.toMatch(/classified|probe|MAINTENANCE/i)
    expect(JSON.stringify(facts)).not.toMatch(/\bhandyman services by\b/i)
    expect(JSON.stringify(facts)).not.toMatch(/\bunit ecosafe pest\b/i)
    expect(facts.milestones.every((step) => !step.endsWith(' by') && !step.endsWith(' for'))).toBe(
      true,
    )
  })

  it('builds fallback copy for freezer (NTA), heater leak (Manny $2), Ecosafe, dryer fire', () => {
    const freezer = buildFeedFactSheet({
      issueHeadline: 'Broken freezer door seal',
      vendorName: 'NTA Handyman Services',
      awaitingLandlordChoiceAt: '2026-11-03T12:00:00.000Z',
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    expect(fallbackFeedCardCopy(freezer).headline).toMatch(/Pick vendor|freezer|seal/i)
    expect(fallbackFeedCardCopy(freezer).status_line).toMatch(/Waiting on you/)

    const heater = buildFeedFactSheet({
      issueHeadline: 'Baseboard heater leak',
      vendorName: 'Manny Plumber',
      spendStatus: 'pending_approval',
      estimateAmount: 2,
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    const heaterCopy = fallbackFeedCardCopy(heater)
    expect(heaterCopy.headline).toMatch(/Manny/)
    expect(heaterCopy.headline).toMatch(/\$2/)

    const ecosafeInvoice = buildFeedFactSheet({
      issueHeadline: 'Kitchen sink leak',
      vendorName: 'Ecosafe Pest Control',
      spendStatus: 'invoice_pending',
      recognizedSpendAmount: 2300,
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    expect(fallbackFeedCardCopy(ecosafeInvoice).headline).toMatch(/Ecosafe/)
    expect(fallbackFeedCardCopy(ecosafeInvoice).headline).toMatch(/2,300|\$2300|\$2,300/)

    const ecosafeWaiting = buildFeedFactSheet({
      issueHeadline: 'Ants in kitchen',
      vendorName: 'Ecosafe Pest Control',
      vendorWorkStatus: 'pending_accept',
      building: '78 Maple Ave',
      unitLabel: '2',
    })
    expect(fallbackFeedCardCopy(ecosafeWaiting).headline).toMatch(/Ecosafe/)

    const fire = buildFeedFactSheet({
      issueHeadline: 'Dryer caught fire',
      awaitingLandlordChoiceAt: '2026-11-05T12:00:00.000Z',
      building: '12 Oak St',
    })
    expect(fire.safety).toBe(true)
    expect(fallbackFeedCardCopy(fire).headline).toMatch(/⚠|fire/i)
  })

  it('uses non-job templates for activation, photo, and home check decline', () => {
    expect(nonJobFeedCardCopy({ kind: 'vendor_activated', vendorName: 'Bmore Appliances' }).headline).toBe(
      'Bmore activated',
    )
    expect(
      nonJobFeedCardCopy({
        kind: 'vendor_activated_without_docs',
        vendorName: 'NTA Handyman',
      }).headline,
    ).toBe('NTA activated without documents')
    expect(
      nonJobFeedCardCopy({ kind: 'photo_no_issues', appliance: 'Water heater photo' }).headline,
    ).toBe('Water heater photo: no issues')
    expect(
      nonJobFeedCardCopy({ kind: 'home_check_declined', tenantName: 'Ivan Petrov' }).headline,
    ).toBe('Home check declined by Ivan')
  })

  it('validator rejects invented names/amounts, overlong lines, and jargon', () => {
    const facts: FeedFactSheet = {
      issue: 'Freezer seal',
      property: '78 Maple Ave',
      unit: '1',
      vendor: 'NTA',
      amount: '$2',
      status: 'needs_vendor',
      waiting_on: 'you',
      waiting_on_name: null,
      safety: false,
      milestones: ['Sent to NTA', 'No reply'],
    }
    expect(validateFeedCardCopy({ headline: 'Acme finished freezer seal', status_line: '' }, facts).ok).toBe(
      false,
    )
    expect(
      validateFeedCardCopy({ headline: 'Freezer seal needs $99', status_line: 'Waiting on you' }, facts).ok,
    ).toBe(false)
    expect(
      validateFeedCardCopy(
        {
          headline: 'This is way too many words for a feed headline row',
          status_line: '',
        },
        facts,
      ).ok,
    ).toBe(false)
    expect(
      validateFeedCardCopy(
        { headline: 'Vendor availability probed', status_line: '' },
        facts,
      ).ok,
    ).toBe(false)
    expect(
      validateFeedCardCopy(
        { headline: 'Pick vendor: freezer seal', status_line: 'Waiting on you to pick' },
        facts,
      ).ok,
    ).toBe(true)
  })

  it('falls back when AI output is invalid (mocked)', () => {
    const facts = buildFeedFactSheet({
      issueHeadline: 'Broken freezer door seal',
      vendorName: 'NTA',
      awaitingLandlordChoiceAt: '2026-11-03T12:00:00.000Z',
    })
    const invalid = { headline: 'Acme workflow probe classified', status_line: '→ batch' }
    expect(validateFeedCardCopy(invalid, facts).ok).toBe(false)
    const fallback = fallbackFeedCardCopy(facts)
    expect(fallback.headline).toMatch(/Pick vendor|freezer|seal/i)
    expect(fallback.headline).not.toMatch(/→|workflow|probe/i)
    expect(feedFactsHash(facts)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('hides digests and does not render trails on story cards', () => {
    const ticket = '074b0000-0000-4000-8000-000000000099'
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'digest',
          eventType: 'ops.needs_admin_vendor_digest',
          label: 'Staff digest',
          message: 'Daily needs-admin vendor digest',
        }),
        feedEvent({
          id: 'alert',
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
          id: 'accept',
          eventType: 'vendor.accepted',
          label: 'Ecosafe accepted',
          createdAt: '2026-11-04T12:00:00.000Z',
          maintenanceRequestId: ticket,
          vendorName: 'Ecosafe',
          building: '78 Maple Ave',
          unitLabel: '1',
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
    expect(selected.map((row) => row.eventType)).not.toContain('ops.needs_admin_vendor_digest')
    expect(selected).toHaveLength(1)
    expect(selected[0]?.storySteps).toBeFalsy()
    expect(selected[0]?.label).not.toMatch(/→/)
    expect(selected[0]?.metadata?._feed_milestones).toBeTruthy()
    expect(selected[0]?.category).toBe('spend')
  })
})
