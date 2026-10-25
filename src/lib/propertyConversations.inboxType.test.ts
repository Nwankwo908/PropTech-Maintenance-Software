import { describe, expect, it } from 'vitest'
import {
  countInboxConversations,
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

  it('includes landlord_update only when includeLandlordUpdate is set', () => {
    expect(isCommunicationInboxConversationType('landlord_update')).toBe(false)
    expect(
      isCommunicationInboxConversationType('landlord_update', {
        includeLandlordUpdate: true,
      }),
    ).toBe(true)
  })
})

describe('countInboxConversations', () => {
  it('counts inbox threads and skips Ask Ulo', () => {
    expect(
      countInboxConversations(['resident_intake', 'ai_copilot', 'vendor_alert', 'landlord_update']),
    ).toBe(2)
    expect(
      countInboxConversations(
        ['resident_intake', 'landlord_update'],
        { includeLandlordUpdate: true },
      ),
    ).toBe(2)
  })
})

describe('landlordUpdateInboxDisplayName', () => {
  it('prefers company name, else Landlord', () => {
    expect(landlordUpdateInboxDisplayName('CEO Rentals')).toBe('CEO Rentals')
    expect(landlordUpdateInboxDisplayName('  ')).toBe('Landlord')
    expect(landlordUpdateInboxDisplayName(null)).toBe('Landlord')
  })
})
