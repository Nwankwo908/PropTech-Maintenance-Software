import { beforeEach, describe, expect, it, vi } from 'vitest'

const { supabaseRpc, requireOnboardingLandlord } = vi.hoisted(() => ({
  supabaseRpc: vi.fn(),
  requireOnboardingLandlord: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => supabaseRpc(...args),
  },
}))

vi.mock('./scope', () => ({
  requireOnboardingLandlord,
}))

import { startFreshOnboardingRun } from './startFreshRun'

const LA2 = 'de300000-0000-4000-8000-000000000004'

describe('startFreshOnboardingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireOnboardingLandlord.mockReturnValue({ ok: true, landlordId: LA2 })
  })

  it('returns the server session when the RPC commits', async () => {
    supabaseRpc.mockResolvedValue({
      data: {
        session_id: 'sess-new',
        started_at: '2026-10-21T12:00:00.000Z',
        landlord_id: LA2,
      },
      error: null,
    })

    const result = await startFreshOnboardingRun({
      landlordId: LA2,
      sessionId: 'sess-new',
    })

    expect(result).toEqual({
      ok: true,
      sessionId: 'sess-new',
      startedAt: '2026-10-21T12:00:00.000Z',
    })
    expect(supabaseRpc).toHaveBeenCalledWith('start_fresh_onboarding_run', {
      p_landlord_id: LA2,
      p_session_id: 'sess-new',
    })
  })

  it('fail-closes when the RPC rejects unsafe cleanup — UI must not clear locally', async () => {
    supabaseRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'This account has live work orders, payments, inspections, or equipment records.',
      },
    })

    const result = await startFreshOnboardingRun({
      landlordId: LA2,
      sessionId: 'sess-blocked',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        'Factory reset deletes your portfolio data and returns you to setup so you can upload documents again.',
      )
    }
  })

  it('rejects unauthorized landlords before calling the RPC', async () => {
    requireOnboardingLandlord.mockReturnValue({
      ok: false,
      error: 'Onboarding is only available for Limited Alpha accounts.',
    })

    const result = await startFreshOnboardingRun({
      landlordId: '00000000-0000-4000-8000-000000000099',
      sessionId: 'sess',
    })

    expect(result.ok).toBe(false)
    expect(supabaseRpc).not.toHaveBeenCalled()
  })

  it('rejects an empty session id without touching inventory', async () => {
    const result = await startFreshOnboardingRun({
      landlordId: LA2,
      sessionId: '   ',
    })
    expect(result.ok).toBe(false)
    expect(supabaseRpc).not.toHaveBeenCalled()
  })
})
