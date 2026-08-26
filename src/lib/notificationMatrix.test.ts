import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  mergeNotificationCategories,
} from '@/lib/notificationSettings'
import { resolveNotificationDelivery } from '@/lib/notificationDelivery'

describe('notification event matrix', () => {
  it('merges saved toggles onto default categories', () => {
    const merged = mergeNotificationCategories(
      [
        {
          id: 'maintenance',
          title: 'Maintenance',
          description: '',
          events: [
            {
              id: 'new_request',
              label: 'New maintenance request',
              channels: { email: false, sms: false, activity_feed: false, push: false },
            },
          ],
        },
      ],
      DEFAULT_NOTIFICATION_SETTINGS.categories,
    )

    const maintenance = merged.find((row) => row.id === 'maintenance')
    const newRequest = maintenance?.events.find((row) => row.id === 'new_request')
    expect(newRequest?.channels.email).toBe(false)
    expect(newRequest?.channels.sms).toBe(false)
    expect(maintenance?.events.some((row) => row.id === 'emergency_request')).toBe(true)
  })

  it('uses per-event matrix channels when resolving delivery', () => {
    const settings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      categories: mergeNotificationCategories(
        [
          {
            id: 'maintenance',
            title: 'Maintenance',
            description: '',
            events: [
              {
                id: 'new_request',
                label: 'New maintenance request',
                channels: { email: false, sms: true, activity_feed: true, push: false },
              },
            ],
          },
        ],
        DEFAULT_NOTIFICATION_SETTINGS.categories,
      ),
    }

    const result = resolveNotificationDelivery({
      settings,
      eventType: 'maintenance.new_request',
      timeZone: 'America/New_York',
      now: new Date('2026-08-01T15:00:00Z'),
    })

    expect(result.allowed).toBe(true)
    expect(result.channels).toEqual(['sms', 'activity_feed'])
  })

  it('blocks muted events from the matrix', () => {
    const settings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      categories: mergeNotificationCategories(
        [
          {
            id: 'maintenance',
            title: 'Maintenance',
            description: '',
            events: [
              {
                id: 'new_request',
                label: 'New maintenance request',
                channels: { email: false, sms: false, activity_feed: false, push: false },
              },
            ],
          },
        ],
        DEFAULT_NOTIFICATION_SETTINGS.categories,
      ),
    }

    const result = resolveNotificationDelivery({
      settings,
      eventType: 'maintenance.new_request',
      timeZone: 'America/New_York',
      now: new Date('2026-08-01T15:00:00Z'),
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('event_muted')
  })
})
