import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mocks.getSession } } }))
vi.mock('@/lib/activeLandlord', () => ({ getActiveLandlordId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
vi.mock('@/api/adminReassignVendor', () => ({
  fetchAdminEdgeFunction: mocks.fetch,
  adminEdgeInvokeHeaders: (secret: string) => ({ 'x-admin-reassign-secret': secret }),
}))
import { syncSmsIdentity, ensureLandlordSmsOnboarding, registerUnitSms } from './landlordSmsOnboarding'
import { ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'
const params = { phone: '+12025550123', identityType: 'resident' as const, residentId: '11111111-1111-4111-8111-111111111111' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://sms-unit.invalid')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'unit-anon-key')
  vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET', 'unit-legacy-value')
  vi.stubEnv('VITE_F08_LEGACY_ADMIN_COMPAT', 'true')
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-session', expires_at: Date.now() / 1000 + 3600 } }, error: null })
  mocks.fetch.mockImplementation(async () => Response.json({ ok: true }))
})
afterEach(() => vi.unstubAllEnvs())
describe('SMS identity session authorization', () => {
  it('requires the user session and temporarily retains the old handler header', async () => {
    expect(await syncSmsIdentity(params)).toBe(true)
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://sms-unit.invalid/functions/v1/sync-sms-identity')
    expect(init.headers).toEqual({ Authorization: 'Bearer synthetic-session', apikey: 'unit-anon-key', 'Content-Type': 'application/json', 'x-admin-reassign-secret': 'unit-legacy-value' })
    expect(JSON.parse(init.body)).toMatchObject(params)
  })
  for (const session of [null, { access_token: '' }, { access_token: 'expired', expires_at: 1 }]) {
    it(`requires sign in for unusable session ${JSON.stringify(session)}`, async () => {
      mocks.getSession.mockResolvedValue({ data: { session }, error: null })
      await expect(syncSmsIdentity(params)).rejects.toThrow(ADMIN_SESSION_REQUIRED)
      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  }
  it('maps an expired server session to the sign-in-again message', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ error: 'Invalid or expired session' }, { status: 401 }))
    await expect(syncSmsIdentity(params)).rejects.toThrow(ADMIN_SESSION_REQUIRED)
  })
  it('returns failure rather than success on account denial', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }))
    expect(await syncSmsIdentity(params)).toBe(false)
  })
  it('fails closed if bridge configuration is missing', async () => {
    vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET', '')
    await expect(syncSmsIdentity(params)).rejects.toThrow('Legacy rollout configuration is missing.')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('keeps the other onboarding transports unchanged', async () => {
    await ensureLandlordSmsOnboarding()
    await registerUnitSms({ unitLabel: '1' })
    expect(mocks.getSession).not.toHaveBeenCalled()
    for (const [, init] of mocks.fetch.mock.calls) expect(init.headers).toEqual({ 'x-admin-reassign-secret': 'unit-legacy-value' })
  })
})
