import type { LandlordAccountOption } from '@/lib/activeLandlord'
import { rememberStaffSwitcherAccountLabels } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type StaffSwitcherSignup = {
  landlordId: string
  alphaNumber: number
  email: string | null
}

export function staffSwitcherSignupLabel(row: {
  alphaNumber: number
  email?: string | null
}): string {
  const base = `Limited Alpha ${row.alphaNumber}`
  const email = row.email?.trim()
  return email ? `${base} · ${email}` : base
}

export function staffSwitcherSignupOptions(
  rows: readonly StaffSwitcherSignup[],
): LandlordAccountOption[] {
  return [...rows]
    .filter((row) => row.landlordId.trim() && Number.isFinite(row.alphaNumber))
    .sort((a, b) => a.alphaNumber - b.alphaNumber || a.landlordId.localeCompare(b.landlordId))
    .map((row) => ({
      kind: 'limited_alpha' as const,
      id: row.landlordId.trim(),
      label: staffSwitcherSignupLabel(row),
    }))
}

function emailFromEmbed(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') return null
  const email = (row as { email?: unknown }).email
  return typeof email === 'string' && email.trim() ? email.trim() : null
}

/** Self-service accounts for the staff switcher. Empty when the registry cannot be read. */
export async function loadStaffSwitcherSignupAccounts(): Promise<LandlordAccountOption[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('limited_alpha_signup_profiles')
    .select('landlord_id, alpha_number, landlords(email)')
    .order('alpha_number', { ascending: true })
  if (error || !data) {
    console.warn('[staff-switcher] signup accounts', error?.message)
    return []
  }
  const options = staffSwitcherSignupOptions(
    data.map((row) => ({
      landlordId: String(row.landlord_id ?? ''),
      alphaNumber: Number(row.alpha_number),
      email: emailFromEmbed(row.landlords),
    })),
  )
  rememberStaffSwitcherAccountLabels(options)
  return options
}
