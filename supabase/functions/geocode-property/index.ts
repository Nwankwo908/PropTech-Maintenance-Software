/**
 * Save Census coordinates when a property is created or its address changes.
 * Uses the same geocoder as outdoor-temperature lookup.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { geocodeUsAddress } from "../_shared/weather/propertyOutdoorTemp.ts"
import { LIMITED_ALPHA_1_LANDLORD_ID } from "../../../shared/landlordCapabilities.ts"
import { geocodeStatusForAddress } from "../../../shared/weather/weatherMonitor.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server misconfiguration" }, 500)

  const auth = req.headers.get("Authorization") ?? ""
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401)

  let body: { propertyId?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const propertyId = body.propertyId?.trim() ?? ""
  if (!propertyId) return json({ error: "propertyId is required" }, 400)

  const supabase = createClient(supabaseUrl, serviceKey)
  const { data: property, error } = await supabase
    .from("properties")
    .select("id, landlord_id, name, street_address, city, state, zip_code")
    .eq("id", propertyId)
    .maybeSingle()
  if (error || !property) return json({ error: "Property not found" }, 404)
  if (property.landlord_id === LIMITED_ALPHA_1_LANDLORD_ID) {
    return json({ skipped: "limited_alpha_1" })
  }

  const address = [property.street_address, property.city, property.state, property.zip_code]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(", ")
  const coords = address ? await geocodeUsAddress(address) : null
  const status = geocodeStatusForAddress(
    typeof property.state === "string" ? property.state : null,
    coords,
  )
  const { error: updateError } = await supabase
    .from("properties")
    .update({
      latitude: coords?.lat ?? null,
      longitude: coords?.lon ?? null,
      geocoded_at: new Date().toISOString(),
      geocode_status: status,
    })
    .eq("id", propertyId)
  if (updateError) return json({ error: updateError.message }, 500)
  return json({ geocodeStatus: status })
})
