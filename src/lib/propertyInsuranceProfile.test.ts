import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  row: null as { profile: Record<string, unknown> } | null,
  upserts: [] as Array<Record<string, unknown>>,
  deletes: 0,
  failWrites: false,
}))

vi.mock('@/lib/activeLandlord', () => ({ getActiveLandlordId: () => 'landlord-1' }))
vi.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    limit: async () => ({
      data: db.row ? [{ building: '109 S Grove St', profile: db.row.profile }] : [],
      error: null,
    }),
    maybeSingle: async () => ({ data: db.row, error: null }),
    upsert: async (payload: Record<string, unknown>) => {
      if (db.failWrites) return { error: { message: 'denied' } }
      db.upserts.push(payload)
      db.row = { profile: payload.profile as Record<string, unknown> }
      return { error: null }
    },
    delete: () => ({
      eq: () => ({
        eq: async () => {
          if (db.failWrites) return { error: { message: 'denied' } }
          db.deletes += 1
          db.row = null
          return { error: null }
        },
      }),
    }),
  }
  return { supabase: { from: () => query } }
})

import {
  deletePropertyInsuranceProfile,
  insuranceProfileIsOnFile,
  loadInsuredPropertyNames,
  loadPropertyInsuranceProfile,
  savePropertyInsuranceProfile,
  toDatabaseProfile,
} from './propertyInsuranceProfile'

const LOCAL_KEY = 'ulo.propertyInsurance.landlord-1.109-s-grove-st'
const store = new Map<string, string>()

const policy = {
  carrier: 'State Farm',
  policyNumber: 'DP-123',
  binderFileName: 'binder.pdf',
  binderFileUrl: 'data:application/pdf;base64,AAAA',
  updatedAt: '2026-10-28T12:00:00.000Z',
}

beforeEach(() => {
  store.clear()
  db.row = null
  db.upserts = []
  db.deletes = 0
  db.failWrites = false
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  })
})

describe('property insurance on the account', () => {
  it('never sends the scanned binder file to the database', async () => {
    const result = await savePropertyInsuranceProfile('109 S Grove St', 'prop-1', policy)
    expect(result.savedToAccount).toBe(true)
    expect(db.upserts[0]).toMatchObject({ landlord_id: 'landlord-1', building: '109 S Grove St', property_id: 'prop-1' })
    expect(db.upserts[0]?.profile).not.toHaveProperty('binderFileUrl')
    expect(toDatabaseProfile(policy)).not.toHaveProperty('binderFileUrl')
    // This browser keeps the file so the download link still works here.
    expect(JSON.parse(store.get(LOCAL_KEY)!).binderFileUrl).toBe(policy.binderFileUrl)
  })

  it('loads the account copy on a new device', async () => {
    db.row = { profile: toDatabaseProfile(policy) }
    const loaded = await loadPropertyInsuranceProfile('109 S Grove St')
    expect(loaded).toMatchObject({ carrier: 'State Farm', policyNumber: 'DP-123', binderFileUrl: null })
    expect(db.upserts).toHaveLength(0)
  })

  it('uploads a policy saved only in this browser the first time it loads', async () => {
    store.set(LOCAL_KEY, JSON.stringify(policy))
    await loadPropertyInsuranceProfile('109 S Grove St', 'prop-1')
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0]?.profile).toMatchObject({ carrier: 'State Farm' })
    // Second load finds it on the account and does not upload again.
    await loadPropertyInsuranceProfile('109 S Grove St', 'prop-1')
    expect(db.upserts).toHaveLength(1)
  })

  it('does not upload an unsaved draft', async () => {
    store.set(LOCAL_KEY, JSON.stringify({ ...policy, updatedAt: null }))
    await loadPropertyInsuranceProfile('109 S Grove St')
    expect(db.upserts).toHaveLength(0)
  })

  it('reports when the account save or delete fails', async () => {
    db.failWrites = true
    expect((await savePropertyInsuranceProfile('109 S Grove St', null, policy)).savedToAccount).toBe(false)
    expect((await deletePropertyInsuranceProfile('109 S Grove St')).deletedFromAccount).toBe(false)
  })

  it('deletes from both the account and this browser', async () => {
    await savePropertyInsuranceProfile('109 S Grove St', null, policy)
    expect((await deletePropertyInsuranceProfile('109 S Grove St')).deletedFromAccount).toBe(true)
    expect(store.has(LOCAL_KEY)).toBe(false)
    expect(db.row).toBeNull()
  })

  it('lists properties with a saved policy for scoring', async () => {
    db.row = { profile: toDatabaseProfile(policy) }
    expect(await loadInsuredPropertyNames()).toEqual(['109 S Grove St'])
    db.row = { profile: { carrier: '', policyNumber: '', updatedAt: '2026-10-28T12:00:00.000Z' } }
    expect(await loadInsuredPropertyNames()).toEqual([])
  })

  it('treats only a saved carrier, policy number or binder as on file', () => {
    expect(insuranceProfileIsOnFile(policy)).toBe(true)
    expect(insuranceProfileIsOnFile({ claimsPhone: '555', updatedAt: '2026-10-28' })).toBe(false)
    expect(insuranceProfileIsOnFile({ carrier: 'State Farm', updatedAt: null })).toBe(false)
    expect(insuranceProfileIsOnFile(null)).toBe(false)
  })
})
