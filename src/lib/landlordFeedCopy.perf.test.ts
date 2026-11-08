import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  attentionAlertFeedLine,
  landlordFeedLine,
  softRewriteFeedLine,
  withFeedScope,
} from '@/lib/landlordFeedCopy'
import { selectLandlordFacingFeedEvents } from '@/lib/propertyOperationsGraph'
import type { PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'

const EVENT_COUNT = 400

function makeBusyFeed(count = EVENT_COUNT): PropertyOperationsTimelineEvent[] {
  const events: PropertyOperationsTimelineEvent[] = []
  const kinds = [
    'vendor.accepted',
    'vendor.declined',
    'vendor.alert_sent',
    'maintenance.spend_recorded',
    'landlord.attention_alert_sent',
    'maintenance.created',
    'inspection.serial_read',
  ] as const

  for (let i = 0; i < count; i += 1) {
    const eventType = kinds[i % kinds.length]!
    const ticket = `${(i % 0xffff).toString(16).padStart(8, '0')}-0000-4000-8000-000000000001`
    const building = `${100 + (i % 40)} Maple Ave`
    const meta: Record<string, unknown> =
      eventType === 'landlord.attention_alert_sent'
        ? {
            kind: 'assign_vendor',
            headline: 'No preferred vendor matched this request',
            detail: 'The leaking kitchen faucet',
            message: 'Told you No preferred vendor matched this request · The leaking kitchen faucet',
            location_line: `${building}, Unit 1, reported 2h ago`,
            total_cost: 2300,
          }
        : {
            total_cost: 2300 + (i % 50),
            vendor_name: i % 2 === 0 ? 'Ecosafe Pest Management' : 'Flex Plumbing Co',
            serial: i % 7 === 0 ? `X${i}32753655` : undefined,
            appliance: 'Water heater',
            message: i % 3 === 0 ? `Noted vendor update ${i}` : `Logged reply ${i}`,
          }

    events.push({
      id: `evt-${i}`,
      eventType,
      label: eventType,
      category: 'work_order',
      message: typeof meta.message === 'string' ? meta.message : null,
      eventSource: 'automation',
      createdAt: new Date(Date.now() - i * 60_000).toISOString(),
      scheduledAt: null,
      unitLabel: '1',
      building,
      residentId: null,
      residentName: null,
      vendorName: typeof meta.vendor_name === 'string' ? meta.vendor_name : null,
      maintenanceRequestId: ticket,
      workflowRunId: `run-${i % 80}`,
      onboardingSessionId: null,
      metadata: meta,
    })
  }
  return events
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!
}

describe('landlord activity feed copy performance', () => {
  it(`rewrites ${EVENT_COUNT} feed rows under 40ms p95`, () => {
    const events = makeBusyFeed()
    const warm = selectLandlordFacingFeedEvents(events, 20)
    expect(warm.length).toBeGreaterThan(0)
    expect(warm.some((e) => /pick a vendor|accepted|spent|Saved/i.test(e.label))).toBe(true)
    expect(warm.every((e) => !/\b(Noted|Logged|Told you|Landlord attention alert)\b/i.test(e.label))).toBe(
      true,
    )

    const samples: number[] = []
    for (let sample = 0; sample < 40; sample += 1) {
      const start = performance.now()
      const selected = selectLandlordFacingFeedEvents(events, 20)
      samples.push(performance.now() - start)
      expect(selected).toHaveLength(warm.length)
    }
    expect(p95(samples)).toBeLessThan(40)
  })

  it('attention + soft rewrite stay cheap for 2k calls', () => {
    const samples: number[] = []
    for (let sample = 0; sample < 25; sample += 1) {
      const start = performance.now()
      for (let i = 0; i < 80; i += 1) {
        softRewriteFeedLine('Noted Ecosafe accepted WO-074B at 14 Maple Ave')
        attentionAlertFeedLine({
          kind: 'assign_vendor',
          headline: 'No preferred vendor matched this request',
          detail: 'The leaking kitchen faucet',
          message: 'Told you No preferred vendor matched · leaking faucet',
          workOrderRef: 'WO-A1B2',
          place: '14 Maple Ave',
        })
        withFeedScope(
          landlordFeedLine({
            eventType: 'vendor.accepted',
            vendorName: 'Ecosafe',
            maintenanceRequestId: '074b0000-0000-4000-8000-000000000001',
            building: '14 Maple Ave',
          })!,
          { workOrderRef: 'WO-074B', place: '14 Maple Ave' },
        )
      }
      samples.push(performance.now() - start)
    }
    expect(p95(samples)).toBeLessThan(25)
  })
})
