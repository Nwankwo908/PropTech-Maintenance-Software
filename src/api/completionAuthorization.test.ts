import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mocks.getSession } } }))
vi.mock('@/lib/activeLandlord', () => ({ getActiveLandlordId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
import { postInspectionWorkflowAction } from './inspectionWorkflowAction'
import { activateUnit } from './unitVacancy'
const actions = [
  { name: 'inspection', invoke: () => postInspectionWorkflowAction({ workflowRunId: '55555555-5555-4555-8555-555555555555', action: 'record_outcome' }), endpoint: 'run-inspection-action' },
  { name: 'activation', invoke: () => activateUnit({ unitId: '11111111-1111-4111-8111-111111111111', skipTenantRegistration: true }), endpoint: 'activate-unit' },
]
describe('inspection and activation use account sessions', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://unit.invalid')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'synthetic-publishable-key')
    vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET', '')
    // These endpoints must not inherit the unrelated F08 rollout flag.
    vi.stubEnv('VITE_F08_LEGACY_ADMIN_COMPAT', 'true')
    vi.stubEnv('VITE_INSPECTION_ACTIVATION_LEGACY_COMPAT', 'false')
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-unusable-user-session', expires_at: Date.now() / 1000 + 3600 } }, error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, unitId: 'synthetic-unit', residentId: null })))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  for (const action of actions) {
    it(`${action.name} sends a session without needing the browser secret`, async () => {
      expect((await action.invoke()).ok).toBe(true)
      const [url, init] = vi.mocked(fetch).mock.calls[0]
      expect(url).toBe(`https://unit.invalid/functions/v1/${action.endpoint}`)
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer synthetic-unusable-user-session')
      expect(headers.has('x-admin-reassign-secret')).toBe(false)
      expect(JSON.parse(String(init?.body)).landlordId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    })
    it(`${action.name} can reach the old guard during an explicit compatibility phase`, async () => {
      vi.stubEnv('VITE_INSPECTION_ACTIVATION_LEGACY_COMPAT', 'true')
      vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET', 'synthetic-unusable-legacy-value')
      expect((await action.invoke()).ok).toBe(true)
      const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers)
      expect(headers.get('Authorization')).toBe('Bearer synthetic-unusable-user-session')
      expect(headers.get('x-admin-reassign-secret')).toBe('synthetic-unusable-legacy-value')
    })
    it(`${action.name} defaults to the bridge when the rollout flag is unset`, async () => {
      vi.stubEnv('VITE_INSPECTION_ACTIVATION_LEGACY_COMPAT', undefined)
      vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET', 'synthetic-unusable-legacy-value')
      expect((await action.invoke()).ok).toBe(true)
      const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers)
      expect(headers.get('Authorization')).toBe('Bearer synthetic-unusable-user-session')
      expect(headers.get('x-admin-reassign-secret')).toBe('synthetic-unusable-legacy-value')
    })
    for (const compatibility of [false, true]) for (const state of ['signed-out', 'expired', 'auth-error']) {
      it(`${action.name} sends no mutation when ${state}, compatibility=${compatibility}`, async () => {
        vi.stubEnv('VITE_INSPECTION_ACTIVATION_LEGACY_COMPAT', String(compatibility))
        vi.stubEnv('VITE_ADMIN_REASSIGN_SECRET', 'synthetic-unusable-legacy-value')
        mocks.getSession.mockResolvedValue({ data: { session: state === 'signed-out' ? null : { access_token: 'synthetic-unusable-user-session', expires_at: state === 'expired' ? 1 : Date.now() / 1000 + 3600 } }, error: state === 'auth-error' ? new Error('synthetic auth failure') : null })
        const result = await action.invoke()
        expect(result).toEqual({ ok: false, error: 'Please sign in again to continue.' })
        expect(fetch).not.toHaveBeenCalled()
      })
    }
  }
})
