import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

/** Load `properties.property_type` by id (best-effort). */
export async function loadPropertyTypeById(
  supabase: SupabaseClient,
  propertyId: string | null | undefined,
): Promise<string | null> {
  const id = typeof propertyId === "string" ? propertyId.trim() : ""
  if (!id) return null
  const { data, error } = await supabase
    .from("properties")
    .select("property_type")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  const raw = (data as { property_type?: unknown }).property_type
  return typeof raw === "string" && raw.trim() ? raw.trim() : null
}
