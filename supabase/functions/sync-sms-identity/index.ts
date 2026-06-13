import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import {
  resolveLandlordId,
  syncResidentSmsIdentity,
} from "../_shared/sms/landlordSmsOnboarding.ts"
import { syncVendorSmsIdentity } from "../_shared/sms/vendorSmsRouting.ts"
import { ensureUnitRow } from "../_shared/unitVacancy.ts"

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

  if (!adminReassignSecretAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
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
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : ""
  if (!phone) {
    return jsonResponse({ error: "phone is required" }, 400)
  }

  const identityType = body.identityType?.trim()
  if (identityType !== "resident" && identityType !== "vendor") {
    return jsonResponse(
      { error: "identityType must be resident or vendor" },
      400,
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  let landlordId: string
  try {
    landlordId = resolveLandlordId(body.landlordId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 400)
  }

  const residentId =
    typeof body.residentId === "string" && uuidRe.test(body.residentId.trim())
      ? body.residentId.trim()
      : undefined
  const vendorId =
    typeof body.vendorId === "string" && uuidRe.test(body.vendorId.trim())
      ? body.vendorId.trim()
      : undefined
  const unitId =
    typeof body.unitId === "string" && uuidRe.test(body.unitId.trim())
      ? body.unitId.trim()
      : undefined

  if (identityType === "resident" && !residentId) {
    return jsonResponse({ error: "residentId is required for resident sync" }, 400)
  }
  if (identityType === "vendor" && !vendorId) {
    return jsonResponse({ error: "vendorId is required for vendor sync" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    let resolvedUnitId = unitId ?? null
    const unitLabel =
      typeof body.unitLabel === "string" ? body.unitLabel.trim() : ""
    const building =
      typeof body.building === "string" ? body.building.trim() : null

    if (!resolvedUnitId && unitLabel) {
      const unitRow = await ensureUnitRow(supabase, {
        landlordId,
        unitLabel,
        building,
      })
      resolvedUnitId = unitRow.id
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
    console.error("[sync-sms-identity] error", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 500)
  }
})
