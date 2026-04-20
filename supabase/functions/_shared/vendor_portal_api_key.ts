import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

/** Resolves vendor by `vendors.portal_api_key` (Bearer token from vendor portal). */
export async function getVendorFromPortalApiKey(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<{ id: string; name: string } | null> {
  const k = apiKey.trim()
  if (!k) return null
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("portal_api_key", k)
    .eq("active", true)
    .maybeSingle()
  if (error) {
    console.error("[vendor_portal_api_key] lookup", error)
    return null
  }
  return data
}
