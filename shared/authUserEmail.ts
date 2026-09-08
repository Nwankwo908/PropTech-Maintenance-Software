/** Email on a Supabase Auth user after Google / OTP (email may live on identity data). */

export function emailFromAuthUser(user: {
  email?: string | null
  user_metadata?: Record<string, unknown> | null
  identities?: Array<{ identity_data?: Record<string, unknown> | null }> | null
} | null | undefined): string {
  if (!user) return ''
  const fromIdentities = (user.identities ?? []).map((identity) => {
    const email = identity.identity_data?.email
    return typeof email === 'string' ? email : ''
  })
  const meta = user.user_metadata ?? {}
  const candidates = [
    user.email,
    typeof meta.email === 'string' ? meta.email : '',
    typeof meta.email_address === 'string' ? meta.email_address : '',
    ...fromIdentities,
  ]
  for (const raw of candidates) {
    const email = raw?.trim()
    if (email) return email
  }
  return ''
}
