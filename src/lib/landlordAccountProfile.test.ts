import { describe, expect, it } from 'vitest'
import {
  notificationChannelFromToggles,
  notificationTogglesFromChannel,
  profileFromAccountSetupFields,
} from './landlordAccountProfile'

describe('landlordAccountProfile', () => {
  it('maps notification channel to organization toggles', () => {
    expect(notificationTogglesFromChannel('sms')).toEqual({
      emailUpdates: false,
      smsAlerts: true,
      activityFeedAlerts: false,
    })
    expect(notificationTogglesFromChannel('both')).toEqual({
      emailUpdates: true,
      smsAlerts: true,
      activityFeedAlerts: true,
    })
  })

  it('maps organization toggles back to notification channel', () => {
    expect(
      notificationChannelFromToggles({
        emailUpdates: true,
        smsAlerts: false,
        activityFeedAlerts: false,
      }),
    ).toBe('email')
  })

  it('builds profile fields from onboarding account setup', () => {
    expect(
      profileFromAccountSetupFields({
        companyName: 'Alpha Property Co',
        contactName: 'Jordan Lee',
        email: 'ceorentalsnj@gmail.com',
        phone: '+15551234567',
        backupContactName: 'Sam Lee',
        backupContactPhone: '+15559876543',
        smsConsentAcceptedAt: null,
      }),
    ).toMatchObject({
      companyName: 'Alpha Property Co',
      contactName: 'Jordan Lee',
      email: 'ceorentalsnj@gmail.com',
      phone: '+15551234567',
      backupContactName: 'Sam Lee',
      backupContactPhone: '+15559876543',
    })
  })
})
