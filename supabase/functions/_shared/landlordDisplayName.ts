import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

/** Public-facing company name for resident/vendor SMS and email copy. */
export async function loadLandlordDisplayName(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("display_name, name")
    .eq("id", landlordId)
    .maybeSingle()

  const display =
    typeof data?.display_name === "string" ? data.display_name.trim() : ""
  if (display) return display

  const legal = typeof data?.name === "string" ? data.name.trim() : ""
  return legal || null
}
