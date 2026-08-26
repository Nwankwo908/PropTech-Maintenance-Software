import { describe, expect, it } from 'vitest'
import { mergeOrganizationForm } from '@/lib/landlordSettings'
import { DEFAULT_ORGANIZATION_SETTINGS } from '@/lib/organizationSettings'

describe('mergeOrganizationForm operational settings', () => {
  it('prefers account_settings operational over stale draft organizationSettings', () => {
    const merged = mergeOrganizationForm({
      persisted: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        escalationThreshold: '9999',
        defaultResponseSla: '24 hours',
        requirePhotoEvidence: true,
        preferredVendorPool: 'Include imported vendors',
        rentReminderCadence: '2, 5, 1 day before',
      },
      legacyLocal: null,
      landlordRow: null,
      onboardingRow: {
        auto_approval_threshold: 500,
        marketplace_preference: 'ulo_vetted_only',
      },
      accountSettings: {
        operational: {
          escalationThreshold: '1800',
          defaultResponseSla: '2 hours',
          requirePhotoEvidence: false,
          rentReminderCadence: '3, 1 day before',
          preferredLanguage: 'Spanish (US)',
        },
        organization: {
          preferredVendorPool: 'Ulo-vetted vendors only',
        },
      },
      draftState: {},
    })

    expect(merged.escalationThreshold).toBe('1800')
    expect(merged.defaultResponseSla).toBe('2 hours')
    expect(merged.requirePhotoEvidence).toBe(false)
    expect(merged.preferredVendorPool).toBe('Ulo-vetted vendors only')
    expect(merged.autoApprovalLimit).toBe('500')
    expect(merged.rentReminderCadence).toBe('3, 1 days before')
    expect(merged.preferredLanguage).toBe('Spanish (US)')
  })

  it('preserves quiet hours times from operational settings', () => {
    const merged = mergeOrganizationForm({
      persisted: DEFAULT_ORGANIZATION_SETTINGS,
      legacyLocal: null,
      landlordRow: null,
      onboardingRow: null,
      accountSettings: {
        operational: {
          quietHoursEnabled: true,
          quietHoursStart: '9:00 PM',
          quietHoursEnd: '7:00 AM',
        },
      },
      draftState: {},
    })

    expect(merged.quietHours).toBe(true)
    expect(merged.quietHoursStart).toBe('9:00 PM')
    expect(merged.quietHoursEnd).toBe('7:00 AM')
  })

  it('maps legacy cadence labels to current options', () => {
    const merged = mergeOrganizationForm({
      persisted: DEFAULT_ORGANIZATION_SETTINGS,
      legacyLocal: null,
      landlordRow: null,
      onboardingRow: null,
      accountSettings: {
        operational: {
          rentReminderCadence: '2, 5, 1 day before',
        },
      },
      draftState: {},
    })

    expect(merged.rentReminderCadence).toBe('5, 3, 1 days before')
  })
})
