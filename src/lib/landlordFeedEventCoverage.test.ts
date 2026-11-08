import { describe, expect, it } from 'vitest'
import { landlordFeedLine } from '@/lib/landlordFeedCopy'
import {
  LANDLORD_FEED_EVENT_CATALOG,
  LANDLORD_FEED_HIDDEN_EVENT_TYPES,
  LANDLORD_FEED_SENTENCE_EVENT_TYPES,
  landlordFeedCoverageGap,
} from '@/lib/landlordFeedEventCoverage'
import { looksLikeDiagnosticLandlordFeedCopy } from '@/lib/landlordFacingTimeline'

describe('landlord feed event coverage', () => {
  it('requires every catalog entry to be hidden or sentenced', () => {
    const gaps = LANDLORD_FEED_EVENT_CATALOG.map(landlordFeedCoverageGap).filter(
      (type): type is string => Boolean(type),
    )
    expect(gaps, `Missing feed coverage for: ${gaps.join(', ')}`).toEqual([])
  })

  it('rejects raw event-name and diagnostic landlord-visible copy', () => {
    const bad = [
      'maintenance open asks closed',
      'Unit/property FK audit found 0 ticket and 2 conversation mismatch(es)',
      'Auto-reassign repeated the same outcome',
      'Resident rent reply received while rent collection is paused.',
    ]
    for (const text of bad) {
      expect(looksLikeDiagnosticLandlordFeedCopy(text), text).toBe(true)
    }
    expect(looksLikeDiagnosticLandlordFeedCopy('Ecosafe accepted the kitchen sink leak')).toBe(false)
  })

  it('keeps hidden and sentenced lists non-empty', () => {
    expect(LANDLORD_FEED_HIDDEN_EVENT_TYPES.length).toBeGreaterThan(5)
    expect(LANDLORD_FEED_SENTENCE_EVENT_TYPES.length).toBeGreaterThan(10)
  })

  it('returns a sentence for every sentenced event type', () => {
    const missing: string[] = []
    for (const eventType of LANDLORD_FEED_SENTENCE_EVENT_TYPES) {
      const line = landlordFeedLine({
        eventType,
        issueHeadline: 'kitchen sink leak',
        vendorName: 'Ecosafe',
        residentName: 'Jordan Lee',
        building: '14 Maple Ave',
        maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
        message: 'Serial number read: X132753655.',
        metadata: {
          total_cost: 2300,
          amount: 1850,
          parsed_action: eventType === 'vendor.replied' ? 'accept' : undefined,
          effect: 'quiet_expire_past_window',
          appliance: 'Water heater',
          serial: 'X132753655',
          photo_count: 3,
          kind: 'assign_vendor',
          headline: 'No preferred vendor matched this request',
          detail: 'The leaking kitchen faucet',
          reason: 'Home Check note was opened as a repair by mistake',
        },
      })
      if (!line?.line?.trim()) missing.push(eventType)
    }
    expect(missing, `No landlordFeedLine sentence for: ${missing.join(', ')}`).toEqual([])
  })
})
