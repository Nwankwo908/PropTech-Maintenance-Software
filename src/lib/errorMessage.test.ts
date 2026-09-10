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

  it('keeps Thumbtack in-app send errors', () => {
    const msg =
      'Could not send this in Ulo. Thumbtack did not issue a messaging token. The Message API app cannot use application login, and it is not on the same environment as vendor search. Ask Thumbtack for production Message API credentials with permission to send requests.'
    expect(toUserFriendlyMessage(msg, 'Could not send this message. The vendor is still available.')).toBe(msg)
  })

  it('maps OTP signup-disabled for first-time admin emails', () => {
    expect(
      toUserFriendlyMessage('Signups not allowed for otp', 'fallback'),
    ).toMatch(/does not have a login yet/i)
  })

  it('maps failed email codes without calling it a permission error', () => {
    expect(toUserFriendlyMessage('Forbidden', 'That code didn’t work. Please try again.')).toBe(
      "You don't have permission to do that.",
    )
    expect(toUserFriendlyMessage('Token has expired or is invalid', 'fallback')).toMatch(
      /code didn’t work/i,
    )
  })

  it('maps unauthorized and missing SMS phone for settings test delivery', () => {
    expect(toUserFriendlyMessage('Unauthorized', 'fallback')).toMatch(/permission/i)
    expect(
      toUserFriendlyMessage('No SMS phone on file for this account.', 'fallback'),
    ).toMatch(/phone number in Organization/i)
  })

  it('maps Telnyx 10DLC carrier blocks', () => {
    expect(
      toUserFriendlyMessage(
        'Not 10DLC registered: The sending number is not 10DLC-registered but is required to be by the carrier.',
        'fallback',
      ),
    ).toMatch(/not registered for business SMS/i)
  })

  it('uses fallback for snake_case codes', () => {
    expect(toUserFriendlyMessage('no_landlord_main_sms', 'Try again later.')).toBe(
      'Try again later.',
    )
  })

  it('maps GPT-4o PDF vision failures instead of the address-mismatch fallback', () => {
    expect(
      toUserFriendlyMessage(
        'GPT-4o vision failed (400)',
        'This report could not be saved. Check that the address matches this property and try again.',
      ),
    ).toMatch(/couldn’t read this inspection report/i)
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
