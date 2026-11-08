import { describe, expect, it } from 'vitest'
import {
  buildMaintenanceWorkOrderTimeline,
  vendorStatusLabel,
} from './escalatedWorkflowReview.ts'
import type { AdminWorkflowTimelineEvent } from './adminWorkflows.ts'
import type { SlaOverdueTicketInput } from './slaOverdueActionReview.ts'

const ticket: SlaOverdueTicketInput = {
  id: 'ticket-1',
  createdAt: '2026-11-07T06:45:00.000Z',
  dueAt: '2026-11-07T20:13:00.000Z',
  urgency: 'normal',
  unit: '2',
  building: '14 Maple',
  description: 'Dryer not heating',
  issueCategory: 'appliance',
  assignedVendorId: 'vendor-1',
  assignedVendorName: 'NTA Services LLC',
  vendorWorkStatus: 'pending_accept',
  residentName: 'Kenniesa Crews',
  assignedAt: '2026-11-06T04:48:00.000Z',
}

describe('buildMaintenanceWorkOrderTimeline', () => {
  it('keeps the operational work-order story with resident and vendor beats', () => {
    const now = new Date('2026-11-07T21:00:00.000Z').getTime()
    const timeline = buildMaintenanceWorkOrderTimeline(ticket, undefined, now)

    expect(timeline.map((entry) => entry.description)).toEqual([
      'Tenant reported via SMS',
      'Classified as Normal · Appliance Repair',
      'Dispatched to NTA Services LLC',
      'Auto-followed up — no response',
      'Response delayed',
    ])
    expect(timeline[0]?.actor).toBe('Kenniesa Crews')
    expect(timeline.at(-1)?.actor).toBe('System')
  })

  it('merges extra landlord-facing workflow events without collapsing the spine', () => {
    const now = new Date('2026-11-07T21:00:00.000Z').getTime()
    const runTimeline: AdminWorkflowTimelineEvent[] = [
      {
        id: 'e1',
        eventType: 'workflow.act',
        label: 'Action taken',
        message: 'Action taken',
        step: 'act',
        stage: 'system',
        createdAt: '2026-11-07T07:00:00.000Z',
      },
      {
        id: 'e2',
        eventType: 'maintenance.vendor_accepted',
        label: 'Vendor accepted',
        message: 'NTA Services LLC accepted the job',
        step: 'act',
        stage: 'vendor',
        createdAt: '2026-11-07T08:00:00.000Z',
      },
    ]

    const timeline = buildMaintenanceWorkOrderTimeline(ticket, runTimeline, now)
    expect(timeline.some((entry) => entry.description === 'Action taken')).toBe(false)
    expect(
      timeline.some((entry) => entry.description === 'NTA Services LLC accepted the job'),
    ).toBe(true)
  })
})

describe('vendorStatusLabel', () => {
  it('matches Active Tasks rail wording for pending accept', () => {
    expect(vendorStatusLabel('pending_accept', 'NTA Services LLC')).toBe(
      'Assigned · awaiting acceptance',
    )
  })
})
