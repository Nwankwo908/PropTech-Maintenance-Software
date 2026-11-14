import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { syncResidentSmsIdentity } from "../_shared/sms/landlordSmsOnboarding.ts"
import { syncVendorSmsIdentity } from "../_shared/sms/vendorSmsRouting.ts"
import { findUnitRow } from "../_shared/unitVacancy.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: {
    landlordId?: string
    phone?: string
    identityType?: string
    residentId?: string | null
    vendorId?: string | null
    unitId?: string | null
    unitLabel?: string | null
    building?: string | null
  }
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Expected JSON object" }, 400)
    }
    body = parsed as typeof body
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!uuidRe.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const phone = typeof body.phone === "string" ? body.phone.trim() : ""
  if (!phone) return jsonResponse({ error: "phone is required" }, 400)
  const identityType = typeof body.identityType === "string" ? body.identityType.trim() : ""
  if (identityType !== "resident" && identityType !== "vendor") {
    return jsonResponse({ error: "identityType must be resident or vendor" }, 400)
  }
  // Never silently discard a malformed or foreign nested identifier.
  for (const key of ["residentId", "vendorId", "unitId"] as const) {
    const value = body[key]
    if (value != null && value !== "" &&
      (typeof value !== "string" || !uuidRe.test(value.trim()))) {
      return jsonResponse({ error: `Invalid ${key}` }, 400)
    }
  }
  const residentId = body.residentId?.trim() || undefined
  const vendorId = body.vendorId?.trim() || undefined
  const unitId = body.unitId?.trim() || undefined
  if (identityType === "resident" && (!residentId || vendorId)) {
    return jsonResponse({ error: "Resident sync requires residentId and no vendorId" }, 400)
  }
  if (identityType === "vendor" && (!vendorId || residentId || unitId || body.unitLabel || body.building)) {
    return jsonResponse({ error: "Vendor sync requires vendorId and no resident or unit fields" }, 400)
  }
  if ((body.unitLabel != null && typeof body.unitLabel !== "string") ||
    (body.building != null && typeof body.building !== "string")) {
    return jsonResponse({ error: "Invalid unit location" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    let resolvedUnitId = unitId ?? null
    const unitLabel =
      typeof body.unitLabel === "string" ? body.unitLabel.trim() : ""
    const building =
      typeof body.building === "string" ? body.building.trim() : null

    const { data: target, error: targetError } = await supabase
      .from(identityType === "resident" ? "users" : "vendors")
      .select("id, landlord_id")
      .eq("id", identityType === "resident" ? residentId! : vendorId!)
      .eq("landlord_id", landlordId).maybeSingle()
    if (targetError) return jsonResponse({ error: "Identity lookup unavailable" }, 503)
    if (!target) return jsonResponse({ error: "Identity not found" }, 404)

    if (resolvedUnitId) {
      const { data: unit, error: unitError } = await supabase
        .from("units").select("id, landlord_id, unit_label, building")
        .eq("id", resolvedUnitId).eq("landlord_id", landlordId).maybeSingle()
      if (unitError) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
      if (!unit) return jsonResponse({ error: "Unit not found" }, 404)
      if (building && String(unit.building ?? "").trim().toLowerCase() !== building.toLowerCase()) {
        return jsonResponse({ error: "Unit location does not match" }, 400)
      }
      // A location label must resolve to the same unit, not override the ID.
      if (unitLabel || building) {
        const matches = await findUnitRow(supabase, {
          landlordId, unitLabel: unitLabel || String(unit.unit_label), building,
        })
        if (!matches || matches.id !== resolvedUnitId) {
          return jsonResponse({ error: "Unit location does not match" }, 400)
        }
      }
    } else if (unitLabel) {
      const unitRow = await findUnitRow(supabase, { landlordId, unitLabel, building })
      if (!unitRow) return jsonResponse({ error: "Unit not found" }, 404)
      if (building && String(unitRow.building ?? "").trim().toLowerCase() !== building.toLowerCase()) {
        return jsonResponse({ error: "Unit location does not match" }, 400)
      }
      resolvedUnitId = unitRow.id
    } else if (building) {
      return jsonResponse({ error: "A unit is required for this location" }, 400)
    }

    const identity =
      identityType === "resident"
        ? await syncResidentSmsIdentity(supabase, {
            landlordId,
            residentId: residentId!,
            tenantPhone: phone,
            unitId: resolvedUnitId,
            unitLabel: unitLabel || null,
            building,
          })
        : await syncVendorSmsIdentity(supabase, {
            landlordId,
            vendorId: vendorId!,
            vendorPhone: phone,
          })

    if (!identity) {
      return jsonResponse({ error: "Invalid phone number" }, 400)
    }

    return jsonResponse({
      ok: true,
      smsIdentityId: identity.id,
      identityType: identity.identity_type,
      phoneNumber: identity.phone_number,
      residentId: identity.resident_id,
      vendorId: identity.vendor_id,
      unitId: identity.unit_id,
    })
  } catch (err) {
    console.error("[sync-sms-identity] operation failed")
    return jsonResponse({ error: "SMS identity sync unavailable" }, 503)
  }
})
