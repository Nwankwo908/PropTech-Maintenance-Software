import { getErrorMessage } from '@/lib/errorMessage'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { removeVendorSetupInboxEntries } from '@/lib/vendorSetupConversation'
import { supabase } from '@/lib/supabase'

export type DeleteCommunicationConversationsResult =
  | { ok: true; deletedCount: number }
  | { ok: false; error: string }

/**
 * Remove selected Communication inbox threads for the active landlord.
 * Deletes `sms_conversations` (messages cascade) and clears local vendor-setup inbox rows.
 */
export async function deleteCommunicationConversationsForLandlord(params: {
  conversationIds: string[]
  landlordId?: string
}): Promise<DeleteCommunicationConversationsResult> {
  const conversationIds = [
    ...new Set(params.conversationIds.map((id) => id.trim()).filter(Boolean)),
  ]
  if (conversationIds.length === 0) return { ok: true, deletedCount: 0 }

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  if (!landlordId) return { ok: false, error: 'No active landlord account.' }

  // Local vendor-setup rows (may not exist in sms_conversations).
  removeVendorSetupInboxEntries(conversationIds, landlordId)

  if (!supabase) {
    return { ok: false, error: 'Supabase is not configured.' }
  }

  const { data, error } = await supabase
    .from('sms_conversations')
    .delete()
    .eq('landlord_id', landlordId)
    .in('id', conversationIds)
    .select('id')

  if (error) {
    return {
      ok: false,
      error: getErrorMessage(error, 'Could not delete selected conversations.'),
    }
  }

  const deletedCount = (data ?? []).length

  return { ok: true, deletedCount: Math.max(deletedCount, conversationIds.length) }
}
