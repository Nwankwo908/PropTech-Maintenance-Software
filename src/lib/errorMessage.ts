/**
 * Unwraps and sanitizes errors for UI display.
 * PostgREST errors are plain objects with `message` / `details`, not `instanceof Error`.
 * Never surface env var names, SQL, HTTP codes, or stack traces to users.
 */

function extractRawMessage(error: unknown): string | null {
  if (error == null) return null
  if (typeof error === 'string') {
    const t = error.trim()
    return t.length > 0 ? t : null
  }
  if (error instanceof Error) {
    const t = error.message.trim()
    return t.length > 0 ? t : null
  }
  if (typeof error === 'object') {
    const o = error as { message?: unknown; details?: unknown; error?: unknown }
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim()
    if (typeof o.error === 'string' && o.error.trim()) return o.error.trim()
    if (typeof o.details === 'string' && o.details.trim()) return o.details.trim()
  }
  return null
}

function looksTechnical(raw: string): boolean {
  const lower = raw.toLowerCase()
  if (raw.length > 220) return true
  if (/[{}[\]]/.test(raw) && /(error|code|details)/i.test(raw)) return true
  if (/\bat\s+\S+\.(ts|tsx|js|jsx):\d+/i.test(raw)) return true
  if (/\b(select|insert|update|delete)\s+.+\bfrom\b/i.test(raw)) return true
  if (/\b(vite_|stripe_|supabase_|deno\.env|process\.env)/i.test(raw)) return true
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i.test(raw)) return true
  if (/^pgrst/i.test(raw)) return true
  if (/\bcolumn\b.+\bdoes not exist\b/i.test(raw)) return true
  if (/\b(relation|table)\b.+\bdoes not exist\b/i.test(raw)) return true
  if (/\bfunctions?relayerror\b/i.test(lower)) return true
  if (/\bnon-2xx\b/i.test(lower)) return true
  if (/failed \(\d{3}\)/i.test(raw)) return true
  return false
}

/** Map known technical / provider strings to plain language. */
export function toUserFriendlyMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const lower = trimmed.toLowerCase()

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('fetch failed') ||
    lower.includes('failed to reach') ||
    lower.includes('network/cors') ||
    lower.includes('cors')
  ) {
    return 'Connection issue. Check your internet and try again.'
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('too many') ||
    lower.includes('over_email_send_rate_limit') ||
    lower.includes('email rate')
  ) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }

  if (
    lower.includes('jwt') ||
    lower.includes('invalid claim') ||
    lower.includes('not authenticated') ||
    lower.includes('auth session missing') ||
    lower === 'no active session' ||
    lower.includes('session expired') ||
    lower.includes('refresh token')
  ) {
    return 'Your session expired. Please sign in again.'
  }

  if (
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('rls') ||
    lower.includes('not authorized') ||
    lower.includes('forbidden')
  ) {
    return "You don't have permission to do that."
  }

  if (
    lower.includes('duplicate key') ||
    lower.includes('unique constraint') ||
    lower.includes('already exists')
  ) {
    if (lower.includes('email') || lower.includes('(email)')) {
      return 'That email is already used by another account. Use a different email.'
    }
    if (lower.includes('resident_id') || lower.includes('users_resident_id')) {
      return 'Couldn’t save that resident. Please try again.'
    }
    if (lower.includes('unit_label') || lower.includes('units_landlord')) {
      return 'Couldn’t save those units. Please try again.'
    }
    if (lower.includes('phone_number') || lower.includes('sms_identities')) {
      return 'That phone number is already linked. Use a different number or reset setup.'
    }
    return 'Couldn’t save that change. Please try again.'
  }

  if (lower.includes('foreign key') || lower.includes('violates foreign key')) {
    return "That change couldn't be saved because it's linked to other records."
  }

  if (lower.includes('check constraint') || lower.includes('violates check')) {
    if (lower.includes('vendors_category') || lower.includes('category_check')) {
      return 'Please select a valid specialty from the list.'
    }
    if (lower.includes('phone_format') || lower.includes('vendors_phone')) {
      return 'Enter a valid phone number like (555) 123-4567.'
    }
    if (lower.includes('notification_channel')) {
      return 'Choose a delivery channel that matches the contact info you entered.'
    }
    return "Some of the information entered isn't valid. Please review and try again."
  }

  if (lower.includes('null value') && lower.includes('violates')) {
    return 'Please fill in all required fields and try again.'
  }

  if (
    lower.includes('vite_') ||
    lower.includes('stripe_secret') ||
    lower.includes('admin_reassign_secret') ||
    (lower.includes('not configured') &&
      (lower.includes('stripe') ||
        lower.includes('supabase') ||
        lower.includes('secret') ||
        lower.includes('missing'))) ||
    (lower.includes('missing') &&
      (lower.includes('configuration') ||
        lower.includes('secret') ||
        lower.includes('vite_')))
  ) {
    return "This feature isn't available right now. Please try again later."
  }

  if (
    lower.includes('stripe') &&
    (lower.includes('could not') ||
      lower.includes('failed') ||
      lower.includes('error') ||
      lower.includes('not configured'))
  ) {
    return "We couldn't complete payment setup. Please try again in a moment."
  }

  if (
    lower.includes('openai_api_key') ||
    lower.includes('incorrect api key') ||
    lower.includes('invalid_api_key') ||
    (lower.includes('document scanning') && lower.includes('not configured'))
  ) {
    return "Document scanning isn't set up yet. Add a valid OpenAI key to Supabase Edge secrets, then try again."
  }

  if (
    lower.includes('edge function') ||
    (lower.includes('function') && lower.includes('non-2xx')) ||
    lower.includes('functionsrelayerror')
  ) {
    return "We couldn't complete that request. Please try again."
  }

  if (
    (lower.includes('storage') || lower.includes('bucket') || lower.includes('object')) &&
    (lower.includes('upload') || lower.includes('not found') || lower.includes('failed'))
  ) {
    return 'Upload failed. Please try again with a different file.'
  }

  if (
    lower.includes('payout setup failed') ||
    lower.includes('could not open payout') ||
    lower.includes('could not prepare your profile for payouts')
  ) {
    return "We couldn't open payout setup. Please try again."
  }

  if (lower.includes('database unavailable') || lower.includes('supabase is not configured')) {
    return "We can't reach the server right now. Please try again in a moment."
  }

  if (lower.includes('import failed')) {
    return "We couldn't finish the import. Please review your documents and try again."
  }

  if (looksTechnical(trimmed)) {
    return fallback
  }

  return trimmed
}

/**
 * Preferred helper for any user-visible error string.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  const raw = extractRawMessage(error)
  if (!raw) return fallback
  return toUserFriendlyMessage(raw, fallback)
}

/** True when Postgres / PostgREST reports a unique-constraint collision. */
export function isUniqueViolation(error: unknown): boolean {
  const raw = extractRawMessage(error)?.toLowerCase() ?? ''
  return (
    raw.includes('duplicate key') ||
    raw.includes('unique constraint') ||
    raw.includes('already exists')
  )
}

const ONBOARDING_SAVE_FALLBACK = 'Couldn’t save this step. Please try again.'

/**
 * Onboarding UI errors — prefer specific unique-constraint copy over generic jargon.
 */
export function getOnboardingErrorMessage(
  error: unknown,
  fallback: string = ONBOARDING_SAVE_FALLBACK,
): string {
  return getErrorMessage(error, fallback)
}
