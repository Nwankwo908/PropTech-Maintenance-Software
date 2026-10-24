import { isPlatformLoginEmail } from '@/lib/landlordSupportEmail'
import { supabase } from '@/lib/supabase'
import { normalizeAdminEmail } from '@shared/admin/staffAllowlist'

function normalizePortalEmail(raw: string): string | null {
  const email = normalizeAdminEmail(raw)
  if (!email.includes('@') || email.length > 254) return null
  if (isPlatformLoginEmail(email)) return null
  return email
}

/** Landlord id for a team-member portal login, or null when the email is not a member. */
export async function landlordIdForPortalMemberEmail(
  email: string | null | undefined,
): Promise<string | null> {
  if (!supabase) return null
  const normalized = normalizePortalEmail(email ?? '')
  if (!normalized) return null
  const { data, error } = await supabase.rpc('landlord_id_for_portal_email', {
    p_email: normalized,
  })
  if (error) {
    console.warn('[portal-members] landlord lookup failed', error.message)
    return null
  }
  return typeof data === 'string' && data.trim() ? data.trim() : null
}

/** Upsert or clear the single team-member login for a landlord account. */
export async function syncLandlordPortalTeamMember(
  landlordId: string,
  member: { email: string; name: string; phone: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: true }
  const id = landlordId.trim()
  if (!id) return { ok: false, error: 'Missing landlord.' }

  const email = normalizePortalEmail(member.email)
  const session = await supabase.auth.getSession()
  const signedInEmail = normalizePortalEmail(session.data.session?.user.email ?? '')
  // A blank optional team member must not remove the person who is signed in.
  // Replacing the row only after the new login exists keeps portal access through the save.
  const keepEmail = email || signedInEmail

  if (email) {
    const { error } = await supabase.from('landlord_portal_members').upsert(
      {
        landlord_id: id,
        email,
        full_name: member.name.trim() || null,
        phone: member.phone.trim() || null,
        role: 'team_member',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'landlord_id,email' },
    )
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        console.warn('[portal-members] table missing; skip team login sync')
        return { ok: true }
      }
      if (/duplicate|unique/i.test(error.message)) {
        return {
          ok: false,
          error: 'That team member email is already used on another account.',
        }
      }
      console.warn('[portal-members] upsert failed', error.message)
      return { ok: false, error: error.message }
    }
  }

  let clear = supabase
    .from('landlord_portal_members')
    .delete()
    .eq('landlord_id', id)
    .eq('role', 'team_member')
  if (keepEmail) clear = clear.neq('email', keepEmail)
  const { error: clearError } = await clear
  if (clearError) {
    if (/does not exist|schema cache/i.test(clearError.message)) {
      console.warn('[portal-members] table missing; skip team login sync')
      return { ok: true }
    }
    console.warn('[portal-members] clear failed', clearError.message)
    return { ok: false, error: clearError.message }
  }
  return { ok: true }
}
