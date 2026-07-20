import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { phoneLookupVariants } from "../sms/inbound_db.ts"

/**
 * Resolve an existing landlord-scoped vendor for verification invites/submits.
 * Prefer an explicit vendorId; otherwise match by email or phone so we update
 * the roster row instead of creating a duplicate. Each invite still gets its
 * own unique verification token — this only links the verification to a vendor.
 */
export async function findLandlordVendorByContact(
  supabase: SupabaseClient,
  landlordId: string,
  opts: {
    vendorId?: string | null
    email?: string | null
    phone?: string | null
  },
): Promise<string | null> {
  const explicitId = opts.vendorId?.trim() || null
  if (explicitId) {
    const { data, error } = await supabase
      .from("vendors")
      .select("id")
      .eq("landlord_id", landlordId)
      .eq("id", explicitId)
      .maybeSingle()
    if (error) {
      console.error("[findVendor] by id", error.message)
    } else if (data?.id) {
      return String(data.id)
    }
  }

  const email = opts.email?.trim()
  if (email) {
    const { data, error } = await supabase
      .from("vendors")
      .select("id")
      .eq("landlord_id", landlordId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error("[findVendor] by email", error.message)
    } else if (data?.id) {
      return String(data.id)
    }
  }

  const phone = opts.phone?.trim()
  if (phone) {
    const variants = phoneLookupVariants(phone)
    if (variants.length > 0) {
      const { data, error } = await supabase
        .from("vendors")
        .select("id")
        .eq("landlord_id", landlordId)
        .in("phone", variants)
        .limit(1)
        .maybeSingle()
      if (error) {
        console.error("[findVendor] by phone", error.message)
      } else if (data?.id) {
        return String(data.id)
      }
    }
  }

  return null
}
