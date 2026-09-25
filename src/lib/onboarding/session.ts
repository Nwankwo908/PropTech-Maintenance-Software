/**
 * Onboarding setup-run identity — isolates residents + feed per Start setup.
 */
export type OnboardingSessionStamp = {
  onboardingSessionId: string
  onboardingSessionStartedAt: string
}

export function mintOnboardingSession(
  now: Date = new Date(),
): OnboardingSessionStamp {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `onb-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`
  return {
    onboardingSessionId: id,
    onboardingSessionStartedAt: now.toISOString(),
  }
}

/** Read a session stamp from landlord onboarding draft/state when both fields are set. */
export function onboardingSessionFromState(
  state: {
    onboardingSessionId?: string | null
    onboardingSessionStartedAt?: string | null
  } | null | undefined,
): OnboardingSessionStamp | null {
  const id = state?.onboardingSessionId?.trim()
  const started = state?.onboardingSessionStartedAt?.trim()
  if (!id || !started) return null
  return { onboardingSessionId: id, onboardingSessionStartedAt: started }
}

export function onboardingSessionUserColumns(
  session: OnboardingSessionStamp | null | undefined,
): Record<string, unknown> {
  if (!session?.onboardingSessionId) return {}
  return {
    onboarding_session_id: session.onboardingSessionId,
    archived_at: null,
  }
}

export function onboardingSessionActivityMetadata(
  session: OnboardingSessionStamp | null | undefined,
): Record<string, unknown> {
  if (!session?.onboardingSessionId) return {}
  return {
    onboarding_session_id: session.onboardingSessionId,
    onboarding_session_started_at: session.onboardingSessionStartedAt,
  }
}

/** True when an event belongs to the active setup run (or has no session bound). */
export function isEventInOnboardingSession(
  event: {
    createdAt?: string | null
    metadataSessionId?: string | null
  },
  session: OnboardingSessionStamp | null | undefined,
): boolean {
  if (!session?.onboardingSessionId || !session.onboardingSessionStartedAt) return true
  const metaId = event.metadataSessionId?.trim()
  if (metaId) return metaId === session.onboardingSessionId
  const created = event.createdAt?.trim()
  if (!created) return false
  return created >= session.onboardingSessionStartedAt
}
