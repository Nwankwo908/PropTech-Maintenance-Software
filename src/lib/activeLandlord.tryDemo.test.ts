import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEMO_LANDLORD_ID,
  LIMITED_ALPHA_1_LOGIN_EMAIL,
} from '@shared/admin/landlordAccess'
import { LIMITED_ALPHA_1_LANDLORD_ID } from '@shared/landlordCapabilities'

function makeStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

const localStorageMock = makeStorageMock()
const sessionStorageMock = makeStorageMock()

vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('sessionStorage', sessionStorageMock)
vi.stubGlobal('window', {
  localStorage: localStorageMock,
  sessionStorage: sessionStorageMock,
})

describe('getActiveLandlordId Try Demo precedence', () => {
  beforeEach(() => {
    localStorageMock.clear()
    sessionStorageMock.clear()
    vi.resetModules()
  })

  it('Try Demo visitor wins over session-bound Alpha landlord', async () => {
    localStorageMock.setItem('ulo.tryDemoVisitor', '1')
    localStorageMock.setItem('ulo.adminActiveLandlord', DEMO_LANDLORD_ID)

    const mod = await import('@/lib/activeLandlord')
    mod.setSessionLandlordFromEmail(LIMITED_ALPHA_1_LOGIN_EMAIL)

    expect(mod.getSessionLandlordId()).toBe(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(mod.isTryDemoVisitor()).toBe(true)
    expect(mod.getActiveLandlordId()).toBe(DEMO_LANDLORD_ID)
    expect(mod.isDemoAccountActive()).toBe(true)
  })

  it('persisted Try Demo visitor still scopes Demo after AuthGate re-binds Alpha', async () => {
    localStorageMock.setItem('ulo.tryDemoVisitor', '1')
    localStorageMock.setItem('ulo.adminActiveLandlord', DEMO_LANDLORD_ID)

    const mod = await import('@/lib/activeLandlord')
    mod.setSessionLandlordFromEmail(LIMITED_ALPHA_1_LOGIN_EMAIL)

    expect(mod.getActiveLandlordId()).toBe(DEMO_LANDLORD_ID)
  })

  it('without Try Demo visitor, session-bound Alpha wins over Demo override', async () => {
    localStorageMock.setItem('ulo.adminActiveLandlord', DEMO_LANDLORD_ID)

    const mod = await import('@/lib/activeLandlord')
    mod.setSessionLandlordFromEmail(LIMITED_ALPHA_1_LOGIN_EMAIL)

    expect(mod.getActiveLandlordId()).toBe(LIMITED_ALPHA_1_LANDLORD_ID)
  })

  it('prepareTryDemoLandlordScope marks welcome pending', async () => {
    const mod = await import('@/lib/activeLandlord')
    mod.prepareTryDemoLandlordScope()
    expect(mod.isTryDemoVisitor()).toBe(true)
    expect(mod.isTryDemoWelcomePending()).toBe(true)
    // Clearing visitor must not wipe the welcome handoff mid auth hop.
    mod.clearTryDemoVisitor()
    expect(mod.isTryDemoWelcomePending()).toBe(true)
    mod.clearTryDemoWelcomePending()
    expect(mod.isTryDemoWelcomePending()).toBe(false)
    expect(mod.isTryDemoWelcomeSeen()).toBe(true)
  })

  it('seen welcome blocks pending until prepare clears it', async () => {
    const mod = await import('@/lib/activeLandlord')
    mod.prepareTryDemoLandlordScope()
    mod.clearTryDemoWelcomePending()
    expect(mod.isTryDemoWelcomeSeen()).toBe(true)
    expect(mod.isTryDemoWelcomePending()).toBe(false)
    mod.prepareTryDemoLandlordScope()
    expect(mod.isTryDemoWelcomeSeen()).toBe(false)
    expect(mod.isTryDemoWelcomePending()).toBe(true)
  })
})
