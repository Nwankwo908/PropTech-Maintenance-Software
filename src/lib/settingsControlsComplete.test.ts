import { describe, expect, it } from 'vitest'
import {
  buildLogoStoragePath,
  encodeLogoStorageRef,
  parseLogoStorageRef,
  validateLogoFile,
} from '@/lib/landlordLogoUpload'
import { mergeOrganizationForm } from '@/lib/landlordSettings'
import { DEFAULT_ORGANIZATION_SETTINGS } from '@/lib/organizationSettings'
import {
  defaultConnectedEmailSettings,
  normalizeConnectedEmailSettings,
  providerLabel,
} from '@/lib/connectedEmailIntegration'
import {
  detectCardBrand,
  formatPaymentMethodLabel,
  normalizeBillingPaymentMethod,
  paymentMethodFromCardInput,
} from '@/lib/billingPaymentMethod'
import { resolveNotificationDelivery } from '@/lib/notificationDelivery'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  mergeNotificationCategories,
} from '@/lib/notificationSettings'

describe('logo upload helpers', () => {
  it('builds a durable storage path and ref', () => {
    const path = buildLogoStoragePath('landlord-1', 'brand.PNG')
    expect(path).toBe('landlord-1/branding/logo.png')
    const ref = encodeLogoStorageRef('landlord-onboarding-documents', path)
    expect(parseLogoStorageRef(ref)).toEqual({
      bucket: 'landlord-onboarding-documents',
      path,
    })
  })

  it('rejects oversized or invalid logo files', () => {
    const badType = new File(['x'], 'notes.txt', { type: 'text/plain' })
    expect(validateLogoFile(badType)).toMatch(/PNG/)
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    expect(validateLogoFile(big)).toMatch(/2 MB/)
  })

  it('loads logoStorageRef from landlords.logo_url', () => {
    const merged = mergeOrganizationForm({
      persisted: DEFAULT_ORGANIZATION_SETTINGS,
      legacyLocal: null,
      landlordRow: {
        logo_url: 'storage:landlord-onboarding-documents/abc/branding/logo.png',
      },
      onboardingRow: null,
      accountSettings: {},
      draftState: {},
    })
    expect(merged.logoStorageRef).toBe(
      'storage:landlord-onboarding-documents/abc/branding/logo.png',
    )
  })
})

describe('push notification prefs', () => {
  it('preserves pushNotifications from account settings', () => {
    const merged = mergeOrganizationForm({
      persisted: DEFAULT_ORGANIZATION_SETTINGS,
      legacyLocal: null,
      landlordRow: null,
      onboardingRow: null,
      accountSettings: {
        notifications: {
          ...DEFAULT_NOTIFICATION_SETTINGS,
          delivery: {
            ...DEFAULT_NOTIFICATION_SETTINGS.delivery,
            pushEnabled: true,
          },
        },
      },
      draftState: {},
    })
    expect(merged.pushNotifications).toBe(true)
  })

  it('includes push when matrix and pushEnabled allow it', () => {
    const settings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      delivery: {
        ...DEFAULT_NOTIFICATION_SETTINGS.delivery,
        pushEnabled: true,
      },
      categories: mergeNotificationCategories(
        [
          {
            id: 'maintenance',
            title: 'Maintenance',
            description: '',
            events: [
              {
                id: 'emergency_request',
                label: 'Emergency',
                critical: true,
                channels: { email: true, sms: false, activity_feed: true, push: true },
              },
            ],
          },
        ],
        DEFAULT_NOTIFICATION_SETTINGS.categories,
      ),
    }

    const result = resolveNotificationDelivery({
      settings,
      eventType: 'maintenance.emergency_request',
      timeZone: 'America/New_York',
      now: new Date('2026-08-01T15:00:00Z'),
    })

    expect(result.allowed).toBe(true)
    expect(result.channels).toContain('push')
    expect(result.channels).toContain('email')
  })
})

describe('connected email settings', () => {
  it('normalizes connect state and automation defaults', () => {
    const normalized = normalizeConnectedEmailSettings({
      connected: true,
      provider: 'gmail',
      email: ' ops@example.com ',
      automation: { rent_roll: true },
    })
    expect(normalized.connected).toBe(true)
    expect(normalized.email).toBe('ops@example.com')
    expect(normalized.automation.new_lease).toBe(true)
    expect(normalized.automation.rent_roll).toBe(true)
    expect(providerLabel('outlook')).toBe('Outlook')
  })

  it('clears incomplete connections', () => {
    const normalized = normalizeConnectedEmailSettings({
      connected: true,
      provider: null,
      email: '',
    })
    expect(normalized.connected).toBe(false)
    expect(defaultConnectedEmailSettings().provider).toBeNull()
  })
})

describe('billing payment method', () => {
  it('detects brand and builds a saved method from card input', () => {
    expect(detectCardBrand('4111111111111111')).toBe('Visa')
    const parsed = paymentMethodFromCardInput({
      cardNumber: '4111 1111 1111 1111',
      expiration: '12 / 30',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.method.last4).toBe('1111')
    expect(formatPaymentMethodLabel(parsed.method)).toBe('Visa ···· 1111')
  })

  it('normalizes persisted payment method rows', () => {
    expect(
      normalizeBillingPaymentMethod({
        brand: 'Mastercard',
        last4: '4444',
        expMonth: '09',
        expYear: '29',
      }),
    ).toEqual({
      brand: 'Mastercard',
      last4: '4444',
      expMonth: '09',
      expYear: '2029',
    })
    expect(normalizeBillingPaymentMethod({ brand: 'Visa', last4: '12' })).toBeNull()
  })
})
