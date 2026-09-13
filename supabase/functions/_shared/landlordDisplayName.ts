import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { landlordPortfolioLabel } from "../../../shared/landlordPortfolioLabel.ts"

/** Public-facing name for resident/vendor SMS and email copy. */
export async function loadLandlordDisplayName(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("display_name, name, contact_name")
    .eq("id", landlordId)
    .maybeSingle()

  const label = landlordPortfolioLabel({
    companyName:
      (typeof data?.display_name === "string" ? data.display_name : "") ||
      (typeof data?.name === "string" ? data.name : ""),
    contactName: typeof data?.contact_name === "string" ? data.contact_name : "",
  })
  return label || null
}
