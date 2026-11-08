import { describe, expect, it } from 'vitest'
import { isConfirmedUpcomingVisit } from '@/lib/scheduledVisitsKpi'

const now = Date.parse('2026-11-01T18:00:00Z')
const today = new Date(now)
today.setHours(10, 0, 0, 0)
const tomorrow = new Date(today)
tomorrow.setDate(tomorrow.getDate() + 1)
const yesterday = new Date(today)
yesterday.setDate(yesterday.getDate() - 1)

const visit = (
  scheduledAt: Date | null,
  status: string,
  confirmed = true,
) => ({
  scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
  scheduleConfirmedAt: confirmed ? '2026-10-28T12:00:00Z' : null,
  vendorWorkStatus: status,
})

describe('isConfirmedUpcomingVisit', () => {
  it('counts a confirmed visit today or later on an open work order', () => {
    expect(isConfirmedUpcomingVisit(visit(today, 'accepted'), now)).toBe(true)
    expect(isConfirmedUpcomingVisit(visit(tomorrow, 'in_progress'), now)).toBe(true)
  })

  it('leaves out an offered window that is not confirmed', () => {
    expect(isConfirmedUpcomingVisit(visit(tomorrow, 'accepted', false), now)).toBe(false)
  })

  it('leaves out a past, completed, cancelled, or declined visit', () => {
    expect(isConfirmedUpcomingVisit(visit(yesterday, 'accepted'), now)).toBe(false)
    expect(isConfirmedUpcomingVisit(visit(tomorrow, 'completed'), now)).toBe(false)
    expect(isConfirmedUpcomingVisit(visit(tomorrow, 'cancelled'), now)).toBe(false)
    expect(isConfirmedUpcomingVisit(visit(tomorrow, 'declined'), now)).toBe(false)
  })
})
