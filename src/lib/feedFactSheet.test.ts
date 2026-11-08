import { describe, expect, it } from 'vitest'
import {
  buildFeedFactSheet,
  fallbackFeedCardCopy,
  looksLikeEmptyTemplateFeedCopy,
  looksLikePropertyInventoryNoise,
  nonJobFeedCardCopy,
  rescheduleNeedsYouCopy,
  shortIssueForFacts,
  shouldHideFeedFactSheet,
  validateFeedCardCopy,
  vendorDisplayName,
  type FeedFactSheet,
} from '@shared/activityFeed/feedFactSheet'
import {
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

describe('feed voice, names, and issue labels', () => {
  it('uses full vendor business names without legal suffixes or initials-only', () => {
    expect(vendorDisplayName('NTA Services LLC')).toBe('NTA Services')
    expect(vendorDisplayName('Ecosafe Pest Management Inc.')).toBe('Ecosafe Pest Management')
    expect(vendorDisplayName('Bmore Appliances')).toBe('Bmore Appliances')
    expect(vendorDisplayName('NTA')).toBeNull()
    expect(vendorDisplayName('Ecosafe Pest Control Co.')).toMatch(/Ecosafe Pest/)
    // Keep “By Michael” — truncating to 3 words left “Handyman Services By”.
    expect(vendorDisplayName('Handyman Services By Michael')).toBe(
      'Handyman Services By Michael',
    )
    expect(vendorDisplayName('Handyman Services By Michael')).not.toMatch(/By$/)
  })

  it('never uses Repair or update as the issue', () => {
    expect(shortIssueForFacts('Repair', null)).toBeNull()
    expect(shortIssueForFacts('update', null)).toBeNull()
    expect(shortIssueForFacts('Broken freezer door seal', 'NTA Services LLC')).toMatch(
      /freezer|seal/i,
    )
    expect(shortIssueForFacts('Baseboard heater leak', null)).toMatch(/heater|leak/i)
    expect(shortIssueForFacts('Dryer caught fire', null)).toMatch(/dryer|fire/i)
    expect(shortIssueForFacts('Pest control — ants', null)).toMatch(/pest|control/i)
  })

  it('builds ulo_did and needs_you fallbacks without waiting lines', () => {
    const freezer = buildFeedFactSheet({
      issueHeadline: 'Broken freezer door seal',
      vendorName: 'NTA Services LLC',
      awaitingLandlordChoiceAt: '2026-11-03T12:00:00.000Z',
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    expect(freezer.kind).toBe('needs_you')
    expect(freezer.vendor).toBe('NTA Services')
    const freezerCopy = fallbackFeedCardCopy(freezer)!
    expect(freezerCopy.headline).toMatch(/^Pick a vendor for the /i)
    expect(freezerCopy.headline).toMatch(/freezer|seal/i)
    expect(freezerCopy.headline).not.toMatch(/\bRepair\b|\bupdate\b/i)
    expect(freezerCopy.status_line).toBe('')

    const fire = buildFeedFactSheet({
      issueHeadline: 'Dryer caught fire',
      awaitingLandlordChoiceAt: '2026-11-04T12:00:00.000Z',
      building: '12 Oak St',
    })
    expect(fire.safety).toBe(true)
    expect(fire.kind).toBe('needs_you')
    expect(fallbackFeedCardCopy(fire)!.headline).toMatch(/^⚠ Pick a vendor for the /i)

    const done = buildFeedFactSheet({
      issueHeadline: 'Broken freezer door seal',
      vendorName: 'NTA Services LLC',
      completedAt: '2026-11-06T12:00:00.000Z',
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    expect(done.kind).toBe('ulo_did')
    expect(fallbackFeedCardCopy(done)!.headline).toMatch(/^Ulo finished/i)
    expect(fallbackFeedCardCopy(done)!.headline).toMatch(/NTA Services/)
  })

  it('derives estimate vs invoice from the current estimate record, not a stale decline', () => {
    const declined = buildFeedFactSheet({
      issueHeadline: 'Baseboard heater leak',
      vendorName: 'Manny Plumber',
      estimateDecision: 'rejected',
      estimateAmount: 2,
      spendStatus: 'pending_approval',
      awaitingLandlordChoiceAt: '2026-11-05T12:00:00.000Z',
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    expect(declined.status).toBe('needs_vendor')
    expect(declined.kind).toBe('needs_you')
    const declinedCopy = fallbackFeedCardCopy(declined)!
    expect(declinedCopy.headline).toMatch(/Pick a vendor/i)
    expect(declinedCopy.headline).not.toMatch(/Approve|waiting on your approval/i)

    const pendingEstimate = buildFeedFactSheet({
      issueHeadline: 'Kitchen sink leak',
      vendorName: 'Ecosafe Pest Management',
      estimateDecision: 'pending_approval',
      estimateAmount: 385,
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    expect(pendingEstimate.status).toBe('estimate_pending')
    expect(fallbackFeedCardCopy(pendingEstimate)!.headline).toMatch(/Approve Ecosafe Pest/)
    expect(fallbackFeedCardCopy(pendingEstimate)!.headline).toMatch(/\$385/)

    const invoice = buildFeedFactSheet({
      issueHeadline: 'Kitchen sink leak',
      vendorName: 'Ecosafe Pest Management',
      estimateDecision: 'approved',
      spendStatus: 'invoice_pending',
      recognizedSpendAmount: 285,
      building: '78 Maple Ave',
      unitLabel: '1',
    })
    expect(invoice.status).toBe('invoice_pending')
    expect(fallbackFeedCardCopy(invoice)!.headline).toMatch(/Approve Ecosafe Pest/)
    expect(fallbackFeedCardCopy(invoice)!.headline).toMatch(/\$285/)
    expect(fallbackFeedCardCopy(invoice)!.headline).toMatch(/invoice/i)
  })

  it('hides rows with no real issue and rejects Repair/update in validator', () => {
    const empty = buildFeedFactSheet({ vendorName: 'NTA Services', awaitingLandlordChoiceAt: 'x' })
    expect(shouldHideFeedFactSheet(empty)).toBe(true)
    expect(fallbackFeedCardCopy(empty)).toBeNull()

    const facts: FeedFactSheet = {
      kind: 'needs_you',
      issue: 'Freezer seal',
      property: '78 Maple Ave',
      unit: '1',
      vendor: 'NTA Services',
      amount: null,
      status: 'needs_vendor',
      waiting_on: 'you',
      waiting_on_name: null,
      safety: false,
      milestones: [],
    }
    expect(
      validateFeedCardCopy({ headline: 'NTA finished: Repair', status_line: '' }, facts).ok,
    ).toBe(false)
    expect(
      validateFeedCardCopy({ headline: 'Pick vendor: Repair', status_line: '' }, facts).ok,
    ).toBe(false)
    expect(
      validateFeedCardCopy(
        { headline: 'Pick a vendor for the freezer seal', status_line: '' },
        facts,
      ).ok,
    ).toBe(true)
    expect(
      validateFeedCardCopy(
        { headline: 'Pick a vendor for the freezer seal', status_line: 'Waiting on you' },
        facts,
      ).ok,
    ).toBe(false)
  })

  it('uses non-job voice templates', () => {
    expect(nonJobFeedCardCopy({ kind: 'vendor_activated', vendorName: 'Bmore Appliances' }).headline).toBe(
      'Ulo activated Bmore Appliances',
    )
    expect(
      nonJobFeedCardCopy({ kind: 'vendor_invited', vendorName: 'NTA Services LLC' }).headline,
    ).toBe('Ulo invited NTA Services to verify')
    expect(
      nonJobFeedCardCopy({
        kind: 'vendor_activated_without_docs',
        vendorName: 'NTA Services LLC',
      }).headline,
    ).toBe('NTA Services has no documents on file')
    expect(nonJobFeedCardCopy({ kind: 'equipment_scan_ok' }).headline).toBe(
      'Ulo checked the equipment scan: no issues',
    )
    expect(
      nonJobFeedCardCopy({
        kind: 'home_check_declined',
        vendorName: 'Ivan Handyman LLC',
      }).headline,
    ).toMatch(/Ivan Handyman declined the home check/)
    expect(
      rescheduleNeedsYouCopy({
        residentName: 'Ganaia Wells',
        issueHeadline: 'Baseboard heater leak',
      })?.headline,
    ).toMatch(/Ganaia asked to reschedule the .+ visit/)
    expect(rescheduleNeedsYouCopy({ residentName: null, issueHeadline: null })).toBeNull()
  })

  it('renders fixture rows with new voice, full names, places, and no empty templates', () => {
    const selected = selectLandlordFacingFeedEvents(
      [
        feedEvent({
          id: 'nta-done',
          eventType: 'maintenance.completed',
          label: 'NTA finished: Repair',
          createdAt: '2026-11-07T10:00:00.000Z',
          maintenanceRequestId: 'aaaa0000-0000-4000-8000-000000000001',
          vendorName: 'NTA Services LLC',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Broken freezer door seal',
          metadata: {
            _feed_ticket: {
              completedAt: '2026-11-07T10:00:00.000Z',
              vendorWorkStatus: 'completed',
            },
          },
        }),
        feedEvent({
          id: 'pick-1',
          eventType: 'landlord.attention_alert_sent',
          label: 'Pick vendor: Repair',
          createdAt: '2026-11-07T09:00:00.000Z',
          maintenanceRequestId: 'bbbb0000-0000-4000-8000-000000000002',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Broken freezer door seal',
          metadata: {
            _feed_ticket: { awaitingLandlordChoiceAt: '2026-11-07T09:00:00.000Z' },
          },
        }),
        feedEvent({
          id: 'pick-fire',
          eventType: 'landlord.attention_alert_sent',
          label: 'Pick vendor: Repair',
          createdAt: '2026-11-04T09:00:00.000Z',
          maintenanceRequestId: 'cccc0000-0000-4000-8000-000000000003',
          building: '12 Oak St',
          propertyType: 'single_family',
          issueHeadline: 'Dryer caught fire',
          metadata: {
            _feed_ticket: { awaitingLandlordChoiceAt: '2026-11-04T09:00:00.000Z' },
          },
        }),
        feedEvent({
          id: 'manny',
          eventType: 'maintenance.estimate_declined',
          label: "Manny's $2 estimate",
          createdAt: '2026-11-06T12:00:00.000Z',
          maintenanceRequestId: 'dddd0000-0000-4000-8000-000000000004',
          vendorName: 'Manny Plumber',
          building: '78 Maple Ave',
          unitLabel: '1',
          propertyType: 'multifamily',
          issueHeadline: 'Baseboard heater leak',
          metadata: {
            amount: 2,
            _feed_ticket: {
              estimateDecision: 'rejected',
              estimateAmount: 2,
              awaitingLandlordChoiceAt: '2026-11-06T12:00:00.000Z',
            },
          },
        }),
        feedEvent({
          id: 'eco-est',
          eventType: 'maintenance.estimate_submitted',
          label: 'Estimate',
          createdAt: '2026-11-06T11:00:00.000Z',
          maintenanceRequestId: 'eeee0000-0000-4000-8000-000000000005',
          vendorName: 'Ecosafe Pest Management',
          building: '78 Maple Ave',
          unitLabel: '2',
          propertyType: 'multifamily',
          issueHeadline: 'Kitchen sink leak',
          metadata: {
            amount: 385,
            _feed_ticket: {
              estimateDecision: 'pending_approval',
              estimateAmount: 385,
            },
          },
        }),
        feedEvent({
          id: 'eco-inv',
          eventType: 'maintenance.spend_recorded',
          label: 'Invoice',
          createdAt: '2026-11-06T10:00:00.000Z',
          maintenanceRequestId: 'ffff0000-0000-4000-8000-000000000006',
          vendorName: 'Ecosafe Pest Management',
          building: '78 Maple Ave',
          unitLabel: '2',
          propertyType: 'multifamily',
          issueHeadline: 'Kitchen sink leak',
          metadata: {
            total_cost: 285,
            _feed_ticket: {
              estimateDecision: 'approved',
              spendStatus: 'invoice_pending',
              recognizedSpendAmount: 285,
            },
          },
        }),
        feedEvent({
          id: 'empty-ask',
          eventType: 'landlord.attention_alert_sent',
          label: 'Needs you: they asked for',
          message: 'They asked for',
          createdAt: '2026-11-05T12:00:00.000Z',
        }),
        feedEvent({
          id: 'note-mf',
          eventType: 'property.inventory_updated',
          label: '78 Maple Ave is a multifamily property. Units 1–4 are listed.',
          message: '78 Maple Ave is a multifamily property. Units 1–4 are listed.',
          createdAt: '2026-11-05T11:00:00.000Z',
        }),
        feedEvent({
          id: 'note-occ',
          eventType: 'unit.activated',
          label: '12 Oak St is occupied',
          message: '12 Oak St is occupied',
          createdAt: '2026-11-05T10:00:00.000Z',
        }),
      ],
      20,
    )

    const labels = selected.map((row) => row.label)
    expect(labels.join('\n')).not.toMatch(/\bRepair\b|\bRepair:\s*update\b|Pick vendor: Repair/i)
    expect(labels.join('\n')).not.toMatch(/Needs you:\s*they asked for/i)
    expect(labels.join('\n')).not.toMatch(/multifamily property|is occupied/i)
    expect(labels.some((line) => looksLikeEmptyTemplateFeedCopy(line))).toBe(false)

    const fire = selected.find((row) => /dryer.*fire/i.test(row.label))
    expect(fire).toBeTruthy()
    expect(fire!.label).toMatch(/^⚠ Pick a vendor for the /i)
    expect(selected[0]?.id).toBe(fire!.id)

    const nta = selected.find((row) => /NTA Services/i.test(row.label))
    expect(nta?.label).toMatch(/^Ulo finished/i)
    expect(formatTimelineContextLine(nta!)).toBe('78 Maple Ave · Unit 1')

    const manny = selected.find((row) => /heater leak/i.test(row.label))
    expect(manny?.label).toMatch(/Pick a vendor/i)
    expect(manny?.label).not.toMatch(/Approve|waiting on your approval/i)

    const ecoEst = selected.find((row) => /\$385/.test(row.label))
    expect(ecoEst?.label).toMatch(/Approve Ecosafe Pest/)
    expect(ecoEst?.label).toMatch(/estimate/i)

    const ecoInv = selected.find((row) => /\$285/.test(row.label))
    expect(ecoInv?.label).toMatch(/Approve Ecosafe Pest/)
    expect(ecoInv?.label).toMatch(/invoice/i)

    expect(looksLikePropertyInventoryNoise('78 Maple Ave is a multifamily property. Units 1–4 are listed.')).toBe(
      true,
    )
  })
})
