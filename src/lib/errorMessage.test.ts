import { describe, expect, it } from 'vitest'
import { getErrorMessage, getOnboardingErrorMessage, toUserFriendlyMessage } from './errorMessage'

describe('toUserFriendlyMessage', () => {
  it('maps network failures', () => {
    expect(toUserFriendlyMessage('Failed to fetch', 'fallback')).toMatch(/Connection issue/)
  })

  it('hides env configuration leaks', () => {
    expect(
      toUserFriendlyMessage('Missing VITE_ADMIN_REASSIGN_SECRET configuration', 'fallback'),
    ).toBe("This feature isn't available right now. Please try again later.")
  })

  it('maps email unique collisions to a clear email message', () => {
    expect(
      toUserFriendlyMessage(
        'duplicate key value violates unique constraint "landlords_email_key"',
        'fallback',
      ),
    ).toMatch(/email is already used/i)
  })

  it('maps generic unique collisions without Reset setup jargon', () => {
    expect(
      toUserFriendlyMessage('duplicate key value violates unique constraint "users_pkey"', 'fallback'),
    ).toMatch(/try again/i)
    expect(
      toUserFriendlyMessage('duplicate key value violates unique constraint "users_pkey"', 'fallback'),
    ).not.toMatch(/Reset setup/i)
  })

  it('keeps plain English messages', () => {
    expect(toUserFriendlyMessage('Enter your company and contact name.', 'fallback')).toBe(
      'Enter your company and contact name.',
    )
  })

  it('uses fallback for snake_case codes', () => {
    expect(toUserFriendlyMessage('no_landlord_main_sms', 'Try again later.')).toBe(
      'Try again later.',
    )
  })
})

describe('getOnboardingErrorMessage', () => {
  it('explains resident_id collisions without Reset setup', () => {
    expect(
      getOnboardingErrorMessage({
        message: 'duplicate key value violates unique constraint "users_resident_id_key"',
      }),
    ).toMatch(/resident/i)
    expect(
      getOnboardingErrorMessage({
        message: 'duplicate key value violates unique constraint "users_resident_id_key"',
      }),
    ).not.toMatch(/Reset setup/i)
  })
})

describe('getErrorMessage', () => {
  it('unwraps Error and PostgREST-shaped objects', () => {
    expect(getErrorMessage(new Error('Failed to fetch'), 'fallback')).toMatch(/Connection issue/)
    expect(
      getErrorMessage({ message: 'JWT expired' }, 'fallback'),
    ).toMatch(/session expired/i)
  })
})
