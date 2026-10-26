import { beforeEach, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ provision: vi.fn(), member: vi.fn(), intent: vi.fn(), mark: vi.fn(), otp: vi.fn() }))
vi.mock('@/lib/limitedAlphaSignup', () => ({ ensureMyLimitedAlphaProfile: mocks.provision, hasLimitedAlphaSignupIntent: mocks.intent, markLimitedAlphaSignupIntent: mocks.mark }))
vi.mock('@/lib/landlordPortalMembers', () => ({ landlordIdForPortalMemberEmail: mocks.member }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOtp: mocks.otp } } }))
vi.mock('@/lib/activeLandlord', () => ({ clearTryDemoVisitor: vi.fn(), clearTryDemoWelcomePending: vi.fn() }))
import { isAdminSessionAllowed, sendAdminEmailOtp } from './adminAuth'
const session = (signup = false) => ({ user: { id: 'sim-new-user', email: 'new@example.invalid', user_metadata: { limited_alpha_signup: signup } } }) as Session
beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue(null); mocks.intent.mockReturnValue(false); mocks.otp.mockResolvedValue({ error: null }); mocks.provision.mockResolvedValue('private-profile') })
it('allows a newly verified signup after private provisioning succeeds', async () => {
  expect(await isAdminSessionAllowed(session(true))).toBe(true)
  expect(mocks.provision).toHaveBeenCalledWith('sim-new-user')
})
it('does not provision arbitrary returning sessions without signup intent', async () => {
  expect(await isAdminSessionAllowed(session())).toBe(false)
  expect(mocks.provision).not.toHaveBeenCalled()
})
it('preserves existing members instead of allocating another account', async () => {
  mocks.member.mockResolvedValue('existing-account')
  expect(await isAdminSessionAllowed(session(true))).toBe(true)
  expect(mocks.provision).not.toHaveBeenCalled()
})
it('denies portal access when profile creation fails', async () => {
  mocks.provision.mockRejectedValue(new Error('offline'))
  expect(await isAdminSessionAllowed(session(true))).toBe(false)
})
it('Get Started accepts a new email and requests verified Auth signup', async () => {
  await sendAdminEmailOtp('new@example.invalid', { createUser: true })
  expect(mocks.mark).toHaveBeenCalledOnce()
  expect(mocks.otp).toHaveBeenCalledWith({ email: 'new@example.invalid', options: { shouldCreateUser: true, data: { limited_alpha_signup: true } } })
})
