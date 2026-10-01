import { getErrorMessage } from '@/lib/errorMessage'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { removeVendorSetupInboxEntries } from '@/lib/vendorSetupConversation'
import { supabase } from '@/lib/supabase'

export type DeleteCommunicationConversationsResult =
  | { ok: true; deletedCount: number }
  | { ok: false; error: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DISMISSED_STORAGE_PREFIX = 'ulo.communicationInboxDismissed.'

/** Real `sms_conversations.id` values only — synthetic inbox keys are not UUIDs. */
export function isSmsConversationUuid(id: string): boolean {
  return UUID_RE.test(id.trim())
}

function dismissedStorageKey(landlordId: string): string {
  return `${DISMISSED_STORAGE_PREFIX}${landlordId}`
}

function readDismissedIds(landlordId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(dismissedStorageKey(landlordId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    )
  } catch {
    return new Set()
  }
}

function writeDismissedIds(landlordId: string, ids: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      dismissedStorageKey(landlordId),
      JSON.stringify([...ids]),
    )
  } catch {
    /* ignore quota / private mode */
  }
}

/** Persist dismissals for synthetic inbox rows (work-order-*, vendor-setup-*, …). */
export function dismissCommunicationInboxIds(
  conversationIds: string[],
  landlordId: string = getActiveLandlordId(),
): void {
  const lid = landlordId.trim()
  if (!lid) return
  const next = readDismissedIds(lid)
  let changed = false
  for (const raw of conversationIds) {
    const id = raw.trim()
    if (!id || isSmsConversationUuid(id) || next.has(id)) continue
    next.add(id)
    changed = true
  }
  if (changed) writeDismissedIds(lid, next)
}

export function isCommunicationInboxIdDismissed(
  conversationId: string,
  landlordId: string = getActiveLandlordId(),
): boolean {
  const id = conversationId.trim()
  const lid = landlordId.trim()
  if (!id || !lid) return false
  return readDismissedIds(lid).has(id)
}

/**
 * Remove selected Communication inbox threads for the active landlord.
 * Deletes real `sms_conversations` rows (messages cascade), clears local
 * vendor-setup inbox rows, and dismisses synthetic work-order / other
 * non-UUID inbox keys so they are not sent to Postgres as UUIDs.
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

  const uuidIds = conversationIds.filter((id) => isSmsConversationUuid(id))
  const syntheticIds = conversationIds.filter((id) => !isSmsConversationUuid(id))

  // Local vendor-setup rows (may not exist in sms_conversations).
  removeVendorSetupInboxEntries(conversationIds, landlordId)
  dismissCommunicationInboxIds(syntheticIds, landlordId)

  if (uuidIds.length === 0) {
    return { ok: true, deletedCount: syntheticIds.length }
  }

  if (!supabase) {
    return { ok: false, error: 'Supabase is not configured.' }
  }

  const { data, error } = await supabase
    .from('sms_conversations')
    .delete()
    .eq('landlord_id', landlordId)
    .in('id', uuidIds)
    .select('id')

  if (error) {
    return {
      ok: false,
      error: getErrorMessage(error, 'Could not delete selected conversations.'),
    }
  }

  const deletedCount = (data ?? []).length

  return {
    ok: true,
    deletedCount: Math.max(deletedCount, uuidIds.length) + syntheticIds.length,
  }
}
