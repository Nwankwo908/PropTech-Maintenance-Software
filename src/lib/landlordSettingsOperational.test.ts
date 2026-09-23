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

  it('loads portfolio rent due day from operational settings', () => {
    const merged = mergeOrganizationForm({
      persisted: DEFAULT_ORGANIZATION_SETTINGS,
      legacyLocal: null,
      landlordRow: null,
      onboardingRow: null,
      accountSettings: {
        operational: {
          rentDueDay: '5',
        },
      },
      draftState: {},
    })

    expect(merged.rentDueDay).toBe('5')
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

  it('uses onboarding support email instead of the login mailbox on landlords.email', () => {
    const merged = mergeOrganizationForm({
      persisted: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        supportEmail: 'limitedalpha1@ulohome.io',
      },
      legacyLocal: null,
      landlordRow: {
        email: 'limitedalpha1@ulohome.io',
        name: 'Alpha Property Co',
      },
      onboardingRow: null,
      accountSettings: {},
      draftState: {
        accountSetup: {
          email: 'ceorentalsnj@gmail.com',
          companyName: 'Alpha Property Co',
        },
      },
    })

    expect(merged.supportEmail).toBe('ceorentalsnj@gmail.com')
  })

  it('does not copy the Alpha login mailbox into Support email', () => {
    const merged = mergeOrganizationForm({
      persisted: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        supportEmail: 'limitedalpha1@ulohome.io',
      },
      legacyLocal: null,
      landlordRow: { email: 'limitedalpha1@ulohome.io' },
      onboardingRow: null,
      accountSettings: {},
      draftState: { accountSetup: { email: '' } },
    })

    expect(merged.supportEmail).toBe('')
  })

  it('does not treat the New Landlord placeholder as a company name', () => {
    const merged = mergeOrganizationForm({
      persisted: DEFAULT_ORGANIZATION_SETTINGS,
      legacyLocal: null,
      landlordRow: { name: 'New Landlord', contact_name: 'Alex Rivera' },
      onboardingRow: null,
      accountSettings: {},
      draftState: { accountSetup: { companyName: '', contactName: 'Alex Rivera' } },
    })

    expect(merged.legalName).toBe('')
    expect(merged.displayName).toBe('')
    expect(merged.contactName).toBe('Alex Rivera')
  })

  it('drops leftover sample identity that was never entered by the landlord', () => {
    const merged = mergeOrganizationForm({
      persisted: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        legalName: 'Limited Alpha 1',
        displayName: 'Kendo Homes',
      },
      legacyLocal: { displayName: 'Kendo Properties LLC' },
      landlordRow: { name: 'Limited Alpha 1', display_name: 'Kendo Homes', contact_name: 'Alex' },
      onboardingRow: null,
      accountSettings: {},
      draftState: { accountSetup: { companyName: 'Kendo Properties', contactName: 'Alex' } },
    })

    expect(merged.legalName).toBe('')
    expect(merged.displayName).toBe('')
  })

  it('does not resurrect old company or display names from onboarding JSON', () => {
    const merged = mergeOrganizationForm({
      persisted: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        legalName: 'Old Company LLC',
        displayName: 'Old Brand',
        contactName: 'Old Contact',
      },
      legacyLocal: null,
      landlordRow: {
        name: 'Alex Rivera properties',
        display_name: '',
        contact_name: 'Alex Rivera',
      },
      onboardingRow: null,
      accountSettings: {
        organization: {
          legalName: 'Stale Org From Account Settings',
          displayName: 'Stale Display',
          contactName: 'Stale Contact',
        },
      },
      draftState: {
        accountSetup: {
          companyName: 'Stale Onboarding Co',
          contactName: 'Alex Rivera',
        },
      },
    })

    // Derived "{name} properties" and blank display stay blank — JSON must not fill them.
    expect(merged.legalName).toBe('')
    expect(merged.displayName).toBe('')
    expect(merged.contactName).toBe('Alex Rivera')
  })

  it('clears contact name when the landlords row has none', () => {
    const merged = mergeOrganizationForm({
      persisted: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        contactName: 'Someone Else',
        legalName: 'Prior Co',
        displayName: 'Prior Brand',
      },
      legacyLocal: null,
      landlordRow: {
        name: '',
        display_name: '',
        contact_name: '',
      },
      onboardingRow: null,
      accountSettings: {
        organization: {
          contactName: 'Someone Else',
          legalName: 'Prior Co',
          displayName: 'Prior Brand',
        },
      },
      draftState: { accountSetup: { companyName: '', contactName: '' } },
    })

    expect(merged.contactName).toBe('')
    expect(merged.legalName).toBe('')
    expect(merged.displayName).toBe('')
  })

  it('still uses a real company name stored on the landlords row', () => {
    const merged = mergeOrganizationForm({
      persisted: {
        ...DEFAULT_ORGANIZATION_SETTINGS,
        legalName: 'Wrong Old Co',
        displayName: 'Wrong Old Brand',
      },
      legacyLocal: null,
      landlordRow: {
        name: 'CEO Rentals NJ',
        display_name: 'CEO Rentals',
        contact_name: 'Maurice',
      },
      onboardingRow: null,
      accountSettings: {},
      draftState: {},
    })

    expect(merged.legalName).toBe('CEO Rentals NJ')
    expect(merged.displayName).toBe('CEO Rentals')
    expect(merged.contactName).toBe('Maurice')
  })
})
