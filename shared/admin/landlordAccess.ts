/**
 * Server- and client-safe landlord access rules for admin Ask Ulo / portal scope.
 * Mirrors src/lib/activeLandlord EMAIL_TO_LANDLORD_ID + staff switcher allowlist.
 */

import {
  DEMO_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  isRetiredLandlordAccountId,
} from '../landlordCapabilities.ts'
import { isStaffAdminEmail } from './staffAllowlist.ts'

export { DEMO_LANDLORD_ID }

export const LIMITED_ALPHA_1_LOGIN_EMAIL = 'limitedalpha1@ulohome.io'
export const LIMITED_ALPHA_2_LOGIN_EMAIL = 'limitedalpha2@ulohome.io'

/** Landlords staff may switch into (Ask Ulo / dashboard switcher). */
export const STAFF_SWITCHER_LANDLORD_IDS = [
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  DEMO_LANDLORD_ID,
] as const

/** Seeded portal login email → fixed landlord id. */
export const EMAIL_TO_LANDLORD_ID: Readonly<Record<string, string>> = {
  'ceorentalsnj@gmail.com': LIMITED_ALPHA_1_LANDLORD_ID,
  'iokafor0@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'moreceo@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'nyshaunbrown@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'otbpictures12@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'nwankwo908@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'bfamiloni@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  'adesanmi.ogunfowora@gmail.com': LIMITED_ALPHA_2_LANDLORD_ID,
  [LIMITED_ALPHA_1_LOGIN_EMAIL]: LIMITED_ALPHA_1_LANDLORD_ID,
  [LIMITED_ALPHA_2_LOGIN_EMAIL]: LIMITED_ALPHA_2_LANDLORD_ID,
  'demo@ulohome.io': DEMO_LANDLORD_ID,
}

export function canonicalizeLandlordId(landlordId: string): string {
  const id = landlordId.trim()
  if (isRetiredLandlordAccountId(id)) return LIMITED_ALPHA_1_LANDLORD_ID
  return id
}

export function seededLandlordIdForEmail(email: string | null | undefined): string | null {
  const normalized = (email ?? '').trim().toLowerCase()
  if (!normalized) return null
  const id = EMAIL_TO_LANDLORD_ID[normalized]
  return id ? canonicalizeLandlordId(id) : null
}

export function isStaffSwitcherLandlordId(landlordId: string | null | undefined): boolean {
  const id = canonicalizeLandlordId((landlordId ?? '').trim())
  return (STAFF_SWITCHER_LANDLORD_IDS as readonly string[]).includes(id)
}

/**
 * Pure access check given known membership landlord ids (from DB).
 * Staff core / property-admin emails may use any switcher landlord.
 * Seeded emails may only use their mapped landlord.
 * Portal members may only use landlords listed in memberLandlordIds.
 */
export function emailMayAccessLandlordId(input: {
  email: string | null | undefined
  landlordId: string
  /** landlord_ids from landlord_portal_members for this email (may be empty). */
  memberLandlordIds?: readonly string[]
}): boolean {
  const email = (input.email ?? '').trim().toLowerCase()
  const landlordId = canonicalizeLandlordId(input.landlordId)
  if (!email || !landlordId) return false

  if (isStaffAdminEmail(email) && isStaffSwitcherLandlordId(landlordId)) {
    return true
  }

  const seeded = seededLandlordIdForEmail(email)
  if (seeded) {
    return seeded === landlordId
  }

  const members = (input.memberLandlordIds ?? []).map((id) => canonicalizeLandlordId(id))
  return members.includes(landlordId)
}
