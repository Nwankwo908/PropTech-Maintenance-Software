/**
 * Who initiated an onboarding import — auth user + session for audit.
 */
import { supabase } from '@/lib/supabase'

export type OnboardingImportActor = {
  userId: string | null
  email: string | null
  sessionId: string | null
}

function fingerprintToken(token: string | null | undefined): string | null {
  const value = (token ?? '').trim()
  if (!value) return null
  // Stable short fingerprint — do not store the raw access token.
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return `sess_${hash.toString(16)}`
}

/** Best-effort current portal session. Never throws. */
export async function resolveOnboardingImportActor(): Promise<OnboardingImportActor> {
  if (!supabase) {
    return { userId: null, email: null, sessionId: null }
  }
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) {
      return { userId: null, email: null, sessionId: null }
    }
    const session = data.session
    const userId = session.user?.id?.trim() || null
    const email = session.user?.email?.trim().toLowerCase() || null
    const sessionId =
      (typeof session.user?.id === 'string' && session.access_token
        ? fingerprintToken(`${session.user.id}:${session.access_token.slice(0, 24)}`)
        : fingerprintToken(session.access_token)) || null
    return { userId, email, sessionId }
  } catch {
    return { userId: null, email: null, sessionId: null }
  }
}

export function importActorUserColumns(
  actor: OnboardingImportActor,
  importedAt: string = new Date().toISOString(),
): Record<string, unknown> {
  return {
    imported_by_user_id: actor.userId,
    imported_by_email: actor.email,
    import_session_id: actor.sessionId,
    imported_at: importedAt,
  }
}

export function importActorActivityMetadata(
  actor: OnboardingImportActor,
): Record<string, unknown> {
  return {
    initiated_by_user_id: actor.userId,
    initiated_by_email: actor.email,
    import_session_id: actor.sessionId,
  }
}
