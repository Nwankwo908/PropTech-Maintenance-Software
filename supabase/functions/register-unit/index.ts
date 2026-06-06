import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import {
  onUnitCreated,
  onUnitsCreated,
  resolveLandlordId,
} from "../_shared/sms/landlordSmsOnboarding.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

type UnitPayload = {
  unitLabel?: string
  building?: string | null
  unitId?: string | null
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
    unitLabel?: string
    building?: string | null
    unitId?: string | null
    residentId?: string | null
    tenantPhone?: string | null
    units?: UnitPayload[]
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
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

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    if (Array.isArray(body.units) && body.units.length > 0) {
      const units = body.units
        .map((u) => ({
          unitLabel: typeof u.unitLabel === "string" ? u.unitLabel.trim() : "",
          building: typeof u.building === "string" ? u.building.trim() : null,
          unitId:
            typeof u.unitId === "string" && uuidRe.test(u.unitId.trim())
              ? u.unitId.trim()
              : null,
        }))
        .filter((u) => u.unitLabel.length > 0)

      if (units.length === 0) {
        return jsonResponse({ error: "units array requires unitLabel entries" }, 400)
      }

      const result = await onUnitsCreated(supabase, { landlordId, units })
      return jsonResponse({ ok: true, ...result, unitsRegistered: units.length })
    }

    const unitLabel =
      typeof body.unitLabel === "string" ? body.unitLabel.trim() : ""
    if (!unitLabel) {
      return jsonResponse({ error: "unitLabel or units[] is required" }, 400)
    }

    const result = await onUnitCreated(supabase, {
      landlordId,
      unitLabel,
      building: typeof body.building === "string" ? body.building.trim() : null,
      unitId:
        typeof body.unitId === "string" && uuidRe.test(body.unitId.trim())
          ? body.unitId.trim()
          : null,
      residentId,
      tenantPhone:
        typeof body.tenantPhone === "string" ? body.tenantPhone.trim() : null,
    })

    return jsonResponse({ ok: true, ...result })
  } catch (err) {
    console.error("[register-unit] error", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 500)
  }
})
