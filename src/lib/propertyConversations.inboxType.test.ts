import { describe, expect, it } from 'vitest'
import {
  isAdminDirectedConversationType,
  isCommunicationInboxConversationType,
  landlordUpdateInboxDisplayName,
} from '@/lib/propertyConversations'

describe('isCommunicationInboxConversationType', () => {
  it('keeps tenant and vendor threads on Messages', () => {
    expect(isCommunicationInboxConversationType('resident_intake')).toBe(true)
    expect(isCommunicationInboxConversationType('vendor_alert')).toBe(true)
  })

  it('keeps ai_copilot off Messages (bell only)', () => {
    expect(isAdminDirectedConversationType('ai_copilot')).toBe(true)
    expect(isCommunicationInboxConversationType('ai_copilot')).toBe(false)
    expect(
      isCommunicationInboxConversationType('ai_copilot', {
        includeLandlordUpdate: true,
      }),
    ).toBe(false)
  })

  it('includes landlord_update only when staff opt-in is set', () => {
    expect(isCommunicationInboxConversationType('landlord_update')).toBe(false)
    expect(
      isCommunicationInboxConversationType('landlord_update', {
        includeLandlordUpdate: true,
      }),
    ).toBe(true)
  })
})

describe('landlordUpdateInboxDisplayName', () => {
  it('prefers company name, else Landlord', () => {
    expect(landlordUpdateInboxDisplayName('CEO Rentals')).toBe('CEO Rentals')
    expect(landlordUpdateInboxDisplayName('  ')).toBe('Landlord')
    expect(landlordUpdateInboxDisplayName(null)).toBe('Landlord')
  })
})
