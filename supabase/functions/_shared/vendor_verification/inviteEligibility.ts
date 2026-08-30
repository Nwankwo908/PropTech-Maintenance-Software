/**
 * Verification invites are for onboarding, not job dispatch.
 * Still do not text vendors who are inactive, paused, suspended, or banned.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type VendorInviteCapacityInput = {
  vendorActive?: boolean | null
  availability?: string | null
  rosterStatus?: string | null
}

export function vendorInviteBlockReason(
  input: VendorInviteCapacityInput,
): string | null {
  const roster = (input.rosterStatus ?? "").trim().toLowerCase()
  if (roster === "banned") {
    return "This vendor is banned and cannot receive an invite."
  }
  if (roster === "suspended") {
    return "This vendor is suspended and cannot receive an invite."
  }
  if (input.vendorActive === false) {
    return "This vendor is inactive. Set them to Active before sending an invite."
  }
  const availability = (input.availability ?? "").trim().toLowerCase()
  if (availability === "paused") {
    return "This vendor is paused and is not accepting outreach right now."
  }
  return null
}

export async function loadVendorInviteCapacity(
  supabase: SupabaseClient,
  landlordId: string,
  vendorId: string | null,
): Promise<VendorInviteCapacityInput> {
  if (!vendorId) return {}
  const { data: vendor } = await supabase
    .from("vendors")
    .select("active, roster_status")
    .eq("landlord_id", landlordId)
    .eq("id", vendorId)
    .maybeSingle()

  const { data: verif } = await supabase
    .from("vendor_verifications")
    .select("availability")
    .eq("landlord_id", landlordId)
    .eq("vendor_id", vendorId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    vendorActive: typeof vendor?.active === "boolean" ? vendor.active : null,
    rosterStatus: typeof vendor?.roster_status === "string" ? vendor.roster_status : null,
    availability: typeof verif?.availability === "string" ? verif.availability : null,
  }
}
