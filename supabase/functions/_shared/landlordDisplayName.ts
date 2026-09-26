import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  landlordPortfolioLabel,
  usableOnboardingCompanyName,
} from "../../../shared/landlordPortfolioLabel.ts"

/**
 * Public-facing name for resident/vendor SMS and email copy.
 *
 * Prefer `landlords.name` (written on every Account Setup save) over
 * `display_name`. On shared Limited Alpha accounts, `display_name` often
 * survives factory reset and leaks an older user's company into vendor SMS.
 */
export async function loadLandlordDisplayName(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("display_name, name, contact_name")
    .eq("id", landlordId)
    .maybeSingle()

  const nameRaw = typeof data?.name === "string" ? data.name.trim() : ""
  const displayRaw =
    typeof data?.display_name === "string" ? data.display_name.trim() : ""
  const fromName = usableOnboardingCompanyName(nameRaw)
  // Seeded Limited Alpha / "New Landlord" names mean Account Setup has not written
  // a real company yet. Ignore leftover display_name from a prior shared session.
  const fromDisplay =
    nameRaw && !fromName ? "" : usableOnboardingCompanyName(displayRaw)

  const label = landlordPortfolioLabel({
    companyName: fromName || fromDisplay,
    contactName: typeof data?.contact_name === "string" ? data.contact_name : "",
  })
  return label || null
}
