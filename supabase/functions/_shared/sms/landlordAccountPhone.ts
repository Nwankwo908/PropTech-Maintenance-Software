/**
 * One place that decides whether an inbound From number is a landlord /
 * property-team phone. Shared-DID routing and resolvePhoneIdentity both use this
 * so account ownership cannot disagree between layers.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { LIMITED_ALPHA_LANDLORD_IDS } from "../../../../shared/landlordCapabilities.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"

/** Local copy of inbound phone variants — avoid circular import with inbound_db. */
function phoneLookupVariants(input: string): string[] {
  const trimmed = input.trim()
  const e164 = normalizePhoneFlexible(trimmed)
  const digits = trimmed.replace(/\D/g, "")
  const set = new Set<string>()
  if (trimmed) set.add(trimmed)
  if (e164) set.add(e164)
  if (digits) {
    set.add(digits)
    if (digits.length === 11 && digits.startsWith("1")) set.add(`+${digits}`)
    if (digits.length === 10) set.add(`+1${digits}`)
  }
  return [...set]
}

function uniqueLandlordId(
  rows: Array<{ landlord_id?: string | null }>,
): string | null {
  const unique = [
    ...new Set(
      rows
        .map((row) => String(row?.landlord_id ?? "").trim())
        .filter(Boolean),
    ),
  ]
  return unique.length === 1 ? unique[0] : null
}

export function phoneMatchesAnyCandidate(
  fromNumber: string,
  candidates: Iterable<string>,
): boolean {
  const fromVariants = new Set(phoneLookupVariants(fromNumber))
  if (fromVariants.size === 0) return false
  for (const raw of candidates) {
    if (!raw?.trim()) continue
    for (const v of phoneLookupVariants(raw)) {
      if (fromVariants.has(v)) return true
    }
  }
  return false
}

async function loadLandlordAccountPhones(
  supabase: SupabaseClient,
  landlordIds: readonly string[],
): Promise<Array<{ landlord_id: string; phone: string }>> {
  if (landlordIds.length === 0) return []
  const { data, error } = await supabase
    .from("landlords")
    .select("id, phone")
    .in("id", [...landlordIds])
    .not("phone", "is", null)
    .limit(Math.max(landlordIds.length, 8))

  if (error) {
    console.error("[landlord-phone] account phone lookup", error.message)
    return []
  }

  const out: Array<{ landlord_id: string; phone: string }> = []
  for (const row of data ?? []) {
    const id = typeof row.id === "string" ? row.id.trim() : ""
    const phone = typeof row.phone === "string" ? row.phone.trim() : ""
    if (!id || !phone) continue
    out.push({ landlord_id: id, phone })
  }
  return out
}

/**
 * Match From against landlords.phone and ops/staff numbers for the given
 * landlord scope (defaults to Limited Alpha accounts for shared-DID routing).
 * Returns a unique landlord id, or null when none / ambiguous.
 */
export async function resolveLandlordIdForAccountOrOpsPhone(
  supabase: SupabaseClient,
  fromNumber: string,
  options?: { landlordIds?: readonly string[] },
): Promise<string | null> {
  const variants = phoneLookupVariants(fromNumber)
  if (variants.length === 0) return null

  const scope =
    options?.landlordIds && options.landlordIds.length > 0
      ? options.landlordIds
      : LIMITED_ALPHA_LANDLORD_IDS

  const accountRows = await loadLandlordAccountPhones(supabase, scope)
  const accountMatches = accountRows
    .filter((row) => phoneMatchesAnyCandidate(fromNumber, [row.phone]))
    .map((row) => ({ landlord_id: row.landlord_id }))
  const fromAccount = uniqueLandlordId(accountMatches)
  if (fromAccount) return fromAccount

  // Ops / onboarding / property-manager phones for each scoped landlord.
  const { resolveLandlordOpsPhones } = await import(
    "./tenantActivationAdminAlert.ts"
  )
  const opsMatches: Array<{ landlord_id: string }> = []
  for (const landlordId of scope) {
    const id = landlordId.trim()
    if (!id) continue
    try {
      const { phones } = await resolveLandlordOpsPhones(supabase, id)
      if (phoneMatchesAnyCandidate(fromNumber, phones)) {
        opsMatches.push({ landlord_id: id })
      }
    } catch (e) {
      console.error("[landlord-phone] ops phone lookup", id, e)
    }
  }
  return uniqueLandlordId(opsMatches)
}

/** True when From is this landlord's account or ops/staff number. */
export async function isLandlordAccountOrOpsPhone(
  supabase: SupabaseClient,
  params: { fromNumber: string; landlordId: string },
): Promise<boolean> {
  const landlordId = params.landlordId.trim()
  if (!landlordId) return false
  const matched = await resolveLandlordIdForAccountOrOpsPhone(
    supabase,
    params.fromNumber,
    { landlordIds: [landlordId] },
  )
  return matched === landlordId
}

/** Normalize for tests / callers that already hold candidate lists. */
export function normalizeOpsPhoneCandidate(raw: string): string | null {
  return normalizePhoneFlexible(raw)
}
