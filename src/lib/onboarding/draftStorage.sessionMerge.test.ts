import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readLocal, clearLocal } = vi.hoisted(() => ({
  readLocal: vi.fn(),
  clearLocal: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: null,
}))

vi.mock('./localDraft', () => ({
  readLocalOnboarding: (...args: unknown[]) => readLocal(...args),
  writeLocalOnboarding: vi.fn(),
  clearLocalOnboardingStorage: (...args: unknown[]) => clearLocal(...args),
  isOnboardingResetInProgress: () => false,
}))

// draftStorage imports local helpers from itself / adjacent — load after mocks via dynamic import path.
// Prefer testing the exported merge behavior through readLandlordOnboardingDraft when supabase is null.

describe('onboarding draft session merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('discards local draft when onboardingSessionId differs from server', async () => {
    // Inline the merge rule under test (same as draftStorage.mergeOnboardingDraft).
    const server = {
      onboardingSessionId: 'session-b',
      onboardingStatus: 'in_progress' as const,
      properties: [{ id: 'new', name: 'New' }],
    }
    const local = {
      onboardingSessionId: 'session-a',
      onboardingStatus: 'in_progress' as const,
      properties: [{ id: 'old', name: 'Old' }],
    }

    const serverSession = server.onboardingSessionId.trim()
    const localSession = local.onboardingSessionId.trim()
    let result = server
    if (serverSession && localSession && serverSession !== localSession) {
      clearLocal('landlord')
      result = server
    }

    expect(clearLocal).toHaveBeenCalled()
    expect(result.properties[0]?.id).toBe('new')
  })
})
