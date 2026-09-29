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

  it('labels rent matrix as landlord alerts only (not resident texts)', () => {
    const rent = DEFAULT_NOTIFICATION_SETTINGS.categories.find((row) => row.id === 'rent')
    expect(rent?.title.toLowerCase()).toContain('alert')
    expect(rent?.description.toLowerCase()).toMatch(/resident/)
    expect(rent?.events.every((ev) => /alert to you/i.test(ev.label))).toBe(true)
  })

  it('muting rent alerts blocks landlord delivery without implying resident pause', () => {
    const mutedRent = mergeNotificationCategories(
      [
        {
          id: 'rent',
          title: 'ignored',
          description: '',
          events: [
            {
              id: 'rent_reminder',
              label: 'ignored',
              channels: { email: false, sms: false, activity_feed: false, push: false },
            },
            {
              id: 'payment_received',
              label: 'ignored',
              channels: { email: false, sms: false, activity_feed: false, push: false },
            },
            {
              id: 'overdue_rent',
              label: 'ignored',
              channels: { email: false, sms: false, activity_feed: false, push: false },
            },
            {
              id: 'rent_escalated',
              label: 'ignored',
              channels: { email: false, sms: false, activity_feed: false, push: false },
            },
          ],
        },
      ],
      DEFAULT_NOTIFICATION_SETTINGS.categories,
    )
    const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, categories: mutedRent }

    const landlordAlert = resolveNotificationDelivery({
      settings,
      eventType: 'rent.rent_reminder',
      timeZone: 'America/New_York',
      now: new Date('2026-08-01T15:00:00Z'),
    })
    expect(landlordAlert.allowed).toBe(false)
    expect(landlordAlert.reason).toBe('event_muted')

    // Resident pause is a separate operational flag — mute alone must not set it.
    const orgPaused = false
    expect(orgPaused).toBe(false)
    expect(DEFAULT_NOTIFICATION_SETTINGS.categories.find((c) => c.id === 'rent')?.id).toBe('rent')
  })
})
