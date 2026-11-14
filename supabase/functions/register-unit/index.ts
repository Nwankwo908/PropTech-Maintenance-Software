import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { onUnitCreated, onUnitsCreated } from "../_shared/sms/landlordSmsOnboarding.ts"
import { findUnitRow } from "../_shared/unitVacancy.ts"

const corsHeaders = adminEdgeCorsHeaders
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}
type UnitInput = { unitLabel: string; building: string | null; unitId: string | null }
function validOptionalId(id: unknown): boolean {
  return id == null || id === "" || typeof id === "string" && uuidRe.test(id.trim())
}
function unitInput(value: unknown): UnitInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.unitLabel !== "string" || !row.unitLabel.trim() ||
    !validOptionalId(row.unitId) || row.building != null && typeof row.building !== "string") return null
  return { unitLabel: row.unitLabel.trim(), building: typeof row.building === "string" ? row.building.trim() || null : null,
    unitId: typeof row.unitId === "string" ? row.unitId.trim() || null : null }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as Record<string, unknown>
  } catch { return jsonResponse({ error: "Expected JSON body" }, 400) }
  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!uuidRe.test(landlordId)) return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  if (!validOptionalId(body.residentId) || body.tenantPhone != null && typeof body.tenantPhone !== "string") {
    return jsonResponse({ error: "Invalid resident fields" }, 400)
  }
  const bulk = body.units !== undefined
  if (bulk && (!Array.isArray(body.units) || body.units.length === 0)) {
    return jsonResponse({ error: "units must be a nonempty array" }, 400)
  }
  if (bulk && [body.residentId, body.tenantPhone, body.unitId, body.unitLabel, body.building].some(v => v != null && v !== "")) {
    return jsonResponse({ error: "Use either units or single-unit fields" }, 400)
  }
  const rawUnits = bulk ? body.units as unknown[] : [body]
  const parsed = rawUnits.map(unitInput)
  if (parsed.some(u => u === null)) return jsonResponse({ error: "Invalid unit label, location or ID" }, 400)
  const units = parsed as UnitInput[]
  const residentId = typeof body.residentId === "string" ? body.residentId.trim() || undefined : undefined
  if (body.tenantPhone && !residentId) return jsonResponse({ error: "residentId is required with tenantPhone" }, 400)
  const url = Deno.env.get("SUPABASE_URL")?.trim(), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!url || !key) return jsonResponse({ error: "Server misconfiguration" }, 500)
  const supabase = createClient(url, key)
  try {
    // Validate every nested target before any unit, number, identity or event effect.
    if (residentId) {
      const { data, error } = await supabase.from("users").select("id").eq("id", residentId).eq("landlord_id", landlordId).maybeSingle()
      if (error) return jsonResponse({ error: "Resident lookup unavailable" }, 503)
      if (!data) return jsonResponse({ error: "Resident not found" }, 404)
    }
    for (const unit of units) {
      if (!unit.unitId) continue
      const { data: row, error } = await supabase.from("units").select("id, unit_label, building").eq("id", unit.unitId).eq("landlord_id", landlordId).maybeSingle()
      if (error) return jsonResponse({ error: "Unit lookup unavailable" }, 503)
      if (!row) return jsonResponse({ error: "Unit not found" }, 404)
      if (unit.building && String(row.building ?? "").trim().toLowerCase() !== unit.building.toLowerCase()) return jsonResponse({ error: "Unit location does not match" }, 400)
      const matched = await findUnitRow(supabase, { landlordId, unitLabel: unit.unitLabel, building: unit.building ?? row.building })
      if (!matched || matched.id !== unit.unitId) return jsonResponse({ error: "Unit location does not match" }, 400)
      // Carry the checked canonical label/location through the legacy helper so
      // it cannot create another unit while associating the supplied ID.
      unit.unitLabel = String(row.unit_label)
      unit.building = row.building ?? null
    }
    if (bulk) {
      const result = await onUnitsCreated(supabase, { landlordId, units })
      return jsonResponse({ ok: true, ...result, unitsRegistered: units.length })
    }
    const result = await onUnitCreated(supabase, { landlordId, ...units[0], residentId,
      tenantPhone: typeof body.tenantPhone === "string" ? body.tenantPhone.trim() || null : null })
    return jsonResponse({ ok: true, ...result })
  } catch (err) {
    console.error("[register-unit] operation failed", err)
    return jsonResponse({ error: "Unit registration unavailable" }, 503)
  }
})
