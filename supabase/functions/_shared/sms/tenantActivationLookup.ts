import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { phoneLookupVariants } from "./inbound_db.ts"

export type WaitingActivationResident = {
  id: string
  landlord_id: string
  full_name: string | null
}

/**
 * Waiting roster row for this phone — authority for YES/NO even when identity
 * is missing, mis-routed across shared Twilio, or stuck as vendor.
 */
export async function findWaitingActivationResidentByPhone(
  supabase: SupabaseClient,
  params: {
    fromNumber: string
    landlordId?: string | null
    landlordIds?: string[] | null
  },
): Promise<WaitingActivationResident | null> {
  const variants = phoneLookupVariants(params.fromNumber)
  if (variants.length === 0) return null

  const landlordIds = [
    ...new Set(
      [
        ...(params.landlordIds ?? []),
        params.landlordId?.trim() || "",
      ].map((id) => id.trim()).filter(Boolean),
    ),
  ]

  let query = supabase
    .from("users")
    .select("id, landlord_id, full_name, activation_status, phone")
    .in("phone", variants)
    .eq("activation_status", "waiting")
    .limit(8)

  if (landlordIds.length === 1) {
    query = query.eq("landlord_id", landlordIds[0])
  } else if (landlordIds.length > 1) {
    query = query.in("landlord_id", landlordIds)
  }

  const { data, error } = await query
  if (error) {
    console.warn("[tenantActivationLookup] waiting resident by phone", error.message)
    return null
  }

  const rows = (data ?? []) as WaitingActivationResident[]
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]

  const preferred = params.landlordId?.trim()
  if (preferred) {
    const match = rows.find((row) => row.landlord_id === preferred)
    if (match) return match
  }
  return rows[0] ?? null
}
