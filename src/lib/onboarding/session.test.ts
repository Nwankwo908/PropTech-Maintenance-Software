import { describe, expect, it } from 'vitest'
import {
  isEventInOnboardingSession,
  mintOnboardingSession,
  onboardingSessionActivityMetadata,
  onboardingSessionFromState,
  onboardingSessionUserColumns,
} from './session'

describe('onboarding session helpers', () => {
  it('mints a session id and started-at', () => {
    const session = mintOnboardingSession(new Date('2026-09-25T21:00:00.000Z'))
    expect(session.onboardingSessionId.length).toBeGreaterThan(8)
    expect(session.onboardingSessionStartedAt).toBe('2026-09-25T21:00:00.000Z')
  })

  it('reads a stamp from onboarding state when both fields are set', () => {
    expect(
      onboardingSessionFromState({
        onboardingSessionId: 'sess-1',
        onboardingSessionStartedAt: '2026-09-25T21:00:00.000Z',
      }),
    ).toEqual({
      onboardingSessionId: 'sess-1',
      onboardingSessionStartedAt: '2026-09-25T21:00:00.000Z',
    })
    expect(onboardingSessionFromState({ onboardingSessionId: 'sess-1' })).toBeNull()
  })

  it('maps session onto user columns and activity metadata', () => {
    const session = {
      onboardingSessionId: 'sess-1',
      onboardingSessionStartedAt: '2026-09-25T21:00:00.000Z',
    }
    expect(onboardingSessionUserColumns(session)).toEqual({
      onboarding_session_id: 'sess-1',
      archived_at: null,
    })
    expect(onboardingSessionActivityMetadata(session)).toEqual({
      onboarding_session_id: 'sess-1',
      onboarding_session_started_at: '2026-09-25T21:00:00.000Z',
    })
    expect(onboardingSessionUserColumns(null)).toEqual({})
  })

  it('bounds feed events to the active setup run', () => {
    const session = {
      onboardingSessionId: 'sess-1',
      onboardingSessionStartedAt: '2026-09-25T21:00:00.000Z',
    }
    expect(
      isEventInOnboardingSession(
        { createdAt: '2026-09-25T21:05:00.000Z', metadataSessionId: null },
        session,
      ),
    ).toBe(true)
    expect(
      isEventInOnboardingSession(
        { createdAt: '2026-09-25T20:59:00.000Z', metadataSessionId: null },
        session,
      ),
    ).toBe(false)
    expect(
      isEventInOnboardingSession(
        { createdAt: '2026-09-25T20:59:00.000Z', metadataSessionId: 'sess-1' },
        session,
      ),
    ).toBe(true)
    expect(
      isEventInOnboardingSession(
        { createdAt: '2026-09-25T21:05:00.000Z', metadataSessionId: 'other' },
        session,
      ),
    ).toBe(false)
  })
})
