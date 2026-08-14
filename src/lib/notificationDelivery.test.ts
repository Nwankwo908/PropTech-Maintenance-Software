import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/lib/notificationSettings'
import {
  isWithinQuietHours,
  resolveNotificationDelivery,
} from '@/lib/notificationDelivery'
import { defaultResponseSlaMinutes } from '@/lib/landlordSettings'

describe('notificationDelivery', () => {
  it('blocks non-critical events during quiet hours', () => {
    const result = resolveNotificationDelivery({
      settings: DEFAULT_NOTIFICATION_SETTINGS,
      eventType: 'maintenance.new_request',
      timeZone: 'America/Los_Angeles',
      now: new Date('2026-08-01T06:00:00Z'),
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('quiet_hours')
  })

  it('allows critical events during quiet hours', () => {
    const result = resolveNotificationDelivery({
      settings: DEFAULT_NOTIFICATION_SETTINGS,
      eventType: 'maintenance.emergency_request',
      isCritical: true,
      timeZone: 'America/Los_Angeles',
      now: new Date('2026-08-01T06:00:00Z'),
    })
    expect(result.allowed).toBe(true)
    expect(result.channels.length).toBeGreaterThan(0)
  })

  it('detects overnight quiet-hour windows', () => {
    expect(
      isWithinQuietHours({
        now: new Date('2026-08-01T06:00:00Z'),
        timeZone: 'America/New_York',
        start: '10:00 PM',
        end: '8:00 AM',
      }),
    ).toBe(true)
  })
})

describe('defaultResponseSlaMinutes', () => {
  it('parses hour labels', () => {
    expect(defaultResponseSlaMinutes('4 hours')).toBe(240)
    expect(defaultResponseSlaMinutes('2 hours')).toBe(120)
  })
})
