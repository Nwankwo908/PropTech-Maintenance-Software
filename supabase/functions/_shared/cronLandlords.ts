/**
 * Landlords eligible for platform SMS / rent crons.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

/** Active landlord account ids (capped for cron batch size). */
export async function listLandlordIdsForCron(
  supabase: SupabaseClient,
  limit = 2000,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("landlords")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    console.error("[cronLandlords]", error.message)
    throw new Error(error.message)
  }

  return (data ?? [])
    .map((row) => String((row as { id?: string }).id ?? "").trim())
    .filter(Boolean)
}
