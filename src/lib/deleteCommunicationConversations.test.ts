import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dismissCommunicationInboxIds,
  isCommunicationInboxIdDismissed,
  isSmsConversationUuid,
} from './deleteCommunicationConversations.ts'

const store = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  },
}

vi.stubGlobal('window', { localStorage: localStorageMock })
vi.stubGlobal('localStorage', localStorageMock)

describe('isSmsConversationUuid', () => {
  it('accepts real conversation UUIDs', () => {
    expect(isSmsConversationUuid('832a3229-f309-45e7-8c46-5a685c10e21f')).toBe(true)
  })

  it('rejects synthetic work-order inbox ids', () => {
    expect(
      isSmsConversationUuid('work-order-832a3229-f309-45e7-8c46-5a685c10e21f'),
    ).toBe(false)
  })

  it('rejects vendor-setup and recommendation prefixes', () => {
    expect(isSmsConversationUuid('vendor-setup-15555550100-acme')).toBe(false)
    expect(isSmsConversationUuid('recommendation-abc')).toBe(false)
  })
})

describe('dismissCommunicationInboxIds', () => {
  const landlordId = 'landlord-test-1'

  beforeEach(() => {
    store.clear()
  })

  it('remembers synthetic ids and ignores UUIDs', () => {
    const synthetic = 'work-order-832a3229-f309-45e7-8c46-5a685c10e21f'
    const uuid = '832a3229-f309-45e7-8c46-5a685c10e21f'
    dismissCommunicationInboxIds([synthetic, uuid], landlordId)
    expect(isCommunicationInboxIdDismissed(synthetic, landlordId)).toBe(true)
    expect(isCommunicationInboxIdDismissed(uuid, landlordId)).toBe(false)
  })
})
