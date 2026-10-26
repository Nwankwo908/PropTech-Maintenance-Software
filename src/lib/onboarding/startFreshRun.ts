import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'
import { FACTORY_RESET_CONFIRM_MESSAGE } from './factoryResetOutcome'
import { requireOnboardingLandlord } from './scope'

export type StartFreshOnboardingRunResult =
  | { ok: true; sessionId: string; startedAt: string }
  | { ok: false; error: string }

/**
 * Transactional Limited Alpha Start: clears prior onboarding inventory when safe
 * and stamps the new session on landlord_onboarding. Does not factory-reset.
 */
export async function startFreshOnboardingRun(input: {
  landlordId: string
  sessionId: string
}): Promise<StartFreshOnboardingRunResult> {
  const scope = requireOnboardingLandlord(input.landlordId)
  if (!scope.ok) return scope

  const sessionId = input.sessionId.trim()
  if (!sessionId) {
    return { ok: false, error: 'Missing onboarding session. Please try Start again.' }
  }

  if (!supabase) {
    return {
      ok: false,
      error: "We can't reach the server right now. Please try again in a moment.",
    }
  }

  const { data, error } = await supabase.rpc('start_fresh_onboarding_run', {
    p_landlord_id: scope.landlordId,
    p_session_id: sessionId,
  })

  if (error) {
    const message = getErrorMessage(
      error,
      'Could not start a fresh setup. Your previous portfolio was left unchanged.',
    )
    const blocked = /live work orders, payments, inspections, or equipment records/i.test(message)
    return { ok: false, error: blocked ? FACTORY_RESET_CONFIRM_MESSAGE : message }
  }

  const row = (data ?? {}) as { session_id?: string; started_at?: string }
  return {
    ok: true,
    sessionId: String(row.session_id ?? sessionId),
    startedAt: String(row.started_at ?? new Date().toISOString()),
  }
}
