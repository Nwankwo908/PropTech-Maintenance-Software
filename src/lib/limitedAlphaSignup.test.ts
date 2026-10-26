import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
import { ensureMyLimitedAlphaProfile, hasLimitedAlphaSignupIntent, markLimitedAlphaSignupIntent } from './limitedAlphaSignup'

describe('private Limited Alpha signup', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => { vi.unstubAllGlobals(); mocks.rpc.mockReset() })
  it('requests only the verified caller profile without passing an email or landlord ID', async () => {
    mocks.rpc.mockResolvedValue({ data: { landlord_id: 'a13a0000-1234-4567-89ab-123456789abc' }, error: null })
    expect(await ensureMyLimitedAlphaProfile('sim-user')).toBe('a13a0000-1234-4567-89ab-123456789abc')
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('ensure_my_limited_alpha_profile')
  })
  it('coalesces concurrent requests for the same Auth user', async () => {
    let resolve!: (value: unknown) => void
    mocks.rpc.mockImplementation(() => new Promise(r => { resolve = r }))
    const one = ensureMyLimitedAlphaProfile('sim-user')
    const two = ensureMyLimitedAlphaProfile('sim-user')
    resolve({ data: { landlord_id: 'private-profile' }, error: null })
    expect(await one).toBe(await two)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('fails closed when provisioning fails or returns no profile', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private backend detail' } })
    await expect(ensureMyLimitedAlphaProfile('sim-user')).rejects.toThrow('Could not create your private profile')
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(ensureMyLimitedAlphaProfile('sim-user')).rejects.toThrow('no profile')
  })
  it('carries explicit signup intent across production OAuth hosts without granting access', () => {
    const document = { cookie: '' }
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', { location: { hostname: 'app.ulohome.io', protocol: 'https:' } })
    markLimitedAlphaSignupIntent()
    expect(document.cookie).toContain('Domain=.ulohome.io')
    expect(document.cookie).toContain('Secure')
    expect(hasLimitedAlphaSignupIntent()).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
