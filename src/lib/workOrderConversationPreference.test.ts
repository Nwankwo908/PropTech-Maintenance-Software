import { describe, expect, it } from 'vitest'
import {
  pickPrimaryWorkOrderConversationId,
  pickResidentWorkOrderConversationId,
  pickVendorWorkOrderConversationId,
} from './workOrderConversationPreference'

const resident = { id: 'c-res', conversation_type: 'resident_intake' }
const vendor = { id: 'c-vend', conversation_type: 'vendor_alert' }
const other = { id: 'c-other', conversation_type: 'general' }

describe('workOrderConversationPreference', () => {
  it('prefers resident intake over vendor alert for See thread', () => {
    const picked = pickPrimaryWorkOrderConversationId([vendor, resident], vendor.id)
    expect(picked.conversationId).toBe('c-res')
    expect(picked.vendorConversationId).toBe('c-vend')
  })

  it('keeps vendor id available when resident is primary', () => {
    expect(pickResidentWorkOrderConversationId([resident, vendor])).toBe('c-res')
    expect(pickVendorWorkOrderConversationId([resident, vendor])).toBe('c-vend')
  })

  it('falls back to vendor only when no resident thread exists', () => {
    const picked = pickPrimaryWorkOrderConversationId([vendor], null)
    expect(picked.conversationId).toBe('c-vend')
    expect(picked.vendorConversationId).toBe('c-vend')
  })

  it('uses non-vendor metadata id when resident intake is missing', () => {
    const picked = pickPrimaryWorkOrderConversationId([other, vendor], other.id)
    expect(picked.conversationId).toBe('c-other')
    expect(picked.vendorConversationId).toBe('c-vend')
  })
})
