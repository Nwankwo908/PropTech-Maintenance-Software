import { describe, expect, it } from 'vitest'
import {
  buildSlaRailTimeline,
  isSlaOverdueOpenTicket,
  mergeLandlordRailTimeline,
  type SlaOverdueTicketInput,
  type SlaOverdueTimelineEntry,
} from './slaOverdueActionReview'

const ticket: SlaOverdueTicketInput = {
  id: 'ticket-1',
  createdAt: '2026-08-15T20:30:00.000Z',
  dueAt: '2026-08-15T21:30:00.000Z',
  urgency: 'emergency',
  unit: 'A',
  building: '109 S Grove St',
  description: 'Sparking outlet',
  issueCategory: 'electrical',
  assignedVendorId: null,
  assignedVendorName: null,
  vendorWorkStatus: 'pending_accept',
  residentName: 'Saad Iqbal',
  assignedAt: null,
}

describe('rail Timeline operational story', () => {
  it('keeps reported, classified, and response delayed', () => {
    const timeline = buildSlaRailTimeline(ticket, Date.parse('2026-08-16T12:00:00.000Z'))
    expect(timeline.map((entry) => entry.description)).toEqual([
      'Tenant reported via SMS',
      'Classified as Emergency · Electrical',
      'Response delayed',
    ])
  })

  it('does not collapse the story when workflow events are leftover plumbing', () => {
    const operational = buildSlaRailTimeline(ticket, Date.parse('2026-08-16T12:00:00.000Z'))
    const fromWorkflow: SlaOverdueTimelineEntry[] = [
      { timeLabel: '9:28 PM', description: 'Escalated', actor: 'System' },
    ]
    const merged = mergeLandlordRailTimeline(operational, fromWorkflow)
    expect(merged).toHaveLength(3)
    expect(merged.map((entry) => entry.description)).toEqual([
      'Tenant reported via SMS',
      'Classified as Emergency · Electrical',
      'Response delayed',
    ])
  })

  it('appends extra domain facts that are not already in the story', () => {
    const operational = buildSlaRailTimeline(ticket, Date.parse('2026-08-16T12:00:00.000Z'))
    const fromWorkflow: SlaOverdueTimelineEntry[] = [
      { timeLabel: '9:26 PM', description: 'Resident sent additional photos', actor: 'Saad Iqbal' },
    ]
    const merged = mergeLandlordRailTimeline(operational, fromWorkflow)
    expect(merged.map((entry) => entry.description)).toContain('Resident sent additional photos')
    expect(merged.length).toBe(4)
  })
})

describe('isSlaOverdueOpenTicket', () => {
  const pastDue = '2020-01-01T00:00:00.000Z'

  it('is true while still waiting for a vendor after the response window', () => {
    expect(
      isSlaOverdueOpenTicket({ dueAt: pastDue, vendorWorkStatus: 'pending_accept' }),
    ).toBe(true)
  })

  it('is false after a vendor accepts the job', () => {
    expect(isSlaOverdueOpenTicket({ dueAt: pastDue, vendorWorkStatus: 'accepted' })).toBe(
      false,
    )
    expect(
      isSlaOverdueOpenTicket({ dueAt: pastDue, vendorWorkStatus: 'in_progress' }),
    ).toBe(false)
  })
})
