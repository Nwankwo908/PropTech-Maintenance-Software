/**
 * Clear or archive residents from prior onboarding setup runs.
 */
import { getErrorMessage } from '@/lib/errorMessage'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import { supabase } from '@/lib/supabase'

export async function archiveOrClearPriorOnboardingResidents(params: {
  landlordId: string
  /** Keep only residents stamped with this session. */
  currentSessionId: string
  /** Prefer hard delete; archive if delete is blocked. */
  mode?: 'clear' | 'archive'
}): Promise<{ ok: boolean; error?: string; cleared: number; archived: number }> {
  if (!supabase) {
    return {
      ok: false,
      error: "We can't reach the server right now. Please try again in a moment.",
      cleared: 0,
      archived: 0,
    }
  }

  const landlordId = params.landlordId.trim()
  const currentSessionId = params.currentSessionId.trim()
  if (!landlordId || !currentSessionId) {
    return { ok: true, cleared: 0, archived: 0 }
  }
  const mode = params.mode ?? 'clear'

  const { data, error } = await supabase
    .from('users')
    .select('id, onboarding_session_id, archived_at')
    .eq('landlord_id', landlordId)

  if (error) {
    // Migration not applied — wipe already cleared what it could; don't block Start setup.
    if (/onboarding_session|archived_at|column/i.test(error.message)) {
      console.warn('[onboarding] session resident columns unavailable', error.message)
      return { ok: true, cleared: 0, archived: 0 }
    }
    return {
      ok: false,
      error: getErrorMessage(error, 'Something went wrong. Please try again.'),
      cleared: 0,
      archived: 0,
    }
  }

  const staleIds: string[] = []
  for (const row of data ?? []) {
    const id = String((row as { id?: string }).id ?? '').trim()
    if (!id) continue
    if ((row as { archived_at?: string | null }).archived_at) continue
    const sessionId =
      typeof (row as { onboarding_session_id?: string | null }).onboarding_session_id === 'string'
        ? String((row as { onboarding_session_id: string }).onboarding_session_id).trim()
        : ''
    if (sessionId === currentSessionId) continue
    staleIds.push(id)
  }

  if (staleIds.length === 0) {
    return { ok: true, cleared: 0, archived: 0 }
  }

  if (mode === 'archive') {
    const { error: archiveError } = await supabase
      .from('users')
      .update({ archived_at: new Date().toISOString() })
      .eq('landlord_id', landlordId)
      .in('id', staleIds)
    if (!archiveError) {
      return { ok: true, cleared: 0, archived: staleIds.length }
    }
    if (!/archived_at|column/i.test(archiveError.message)) {
      return {
        ok: false,
        error: getErrorMessage(archiveError, 'Something went wrong. Please try again.'),
        cleared: 0,
        archived: 0,
      }
    }
  }

  const removed = await deleteResidentsForLandlord({
    landlordId,
    residentIds: staleIds,
  })
  if (!removed.ok) {
    const { error: archiveError } = await supabase
      .from('users')
      .update({ archived_at: new Date().toISOString() })
      .eq('landlord_id', landlordId)
      .in('id', staleIds)
    if (!archiveError) {
      return { ok: true, cleared: 0, archived: staleIds.length }
    }
    if (/archived_at|column/i.test(archiveError.message)) {
      // Cannot delete or archive — wipe already ran; do not block Start setup.
      console.warn('[onboarding] prior residents remain', removed.error, archiveError.message)
      return { ok: true, cleared: 0, archived: 0 }
    }
    return { ok: false, error: removed.error, cleared: 0, archived: 0 }
  }

  return { ok: true, cleared: removed.deletedCount, archived: 0 }
}
