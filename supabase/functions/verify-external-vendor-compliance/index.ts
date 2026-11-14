/**
 * POST verify-external-vendor-compliance (verified account session).
 * License + COI checks for Find External Vendor verification screen.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import {
  attestExternalCoiOnFile,
  attestExternalLicenseNumber,
  lookupExternalVendorCompliance,
  type ExternalVendorComplianceSubject,
} from "../_shared/external_vendor/complianceLookup.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function parseSubject(raw: Record<string, unknown>): ExternalVendorComplianceSubject | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  if (!name) return null
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((s): s is string => typeof s === "string" && Boolean(s.trim()))
    : []
  return {
    name,
    phone: typeof raw.phone === "string" ? raw.phone : null,
    website: typeof raw.website === "string" ? raw.website : null,
    tradeLabel: typeof raw.tradeLabel === "string" ? raw.tradeLabel : null,
    priceLabel: typeof raw.priceLabel === "string" ? raw.priceLabel : null,
    sources,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }


  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!isUuidShape(landlordId)) return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const actionRaw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "lookup"
  const subject = parseSubject(body)
  if (!subject) {
    return jsonResponse({ error: "Missing vendor name" }, 400)
  }

  const approverName =
    typeof body.approverName === "string" ? body.approverName.trim() : null

  if (actionRaw === "lookup") {
    const result = await lookupExternalVendorCompliance(subject)
    return jsonResponse({ ok: true, action: "lookup", ...result })
  }

  if (actionRaw === "attest_license") {
    const licenseNumber =
      typeof body.licenseNumber === "string" ? body.licenseNumber : ""
    const attested = attestExternalLicenseNumber({
      subject,
      licenseNumber,
      approverName,
    })
    if ("error" in attested) {
      return jsonResponse({ error: attested.error }, 400)
    }
    return jsonResponse({ ok: true, action: "attest_license", license: attested })
  }

  if (actionRaw === "attest_coi") {
    const attested = attestExternalCoiOnFile({ subject, approverName })
    return jsonResponse({ ok: true, action: "attest_coi", coi: attested })
  }

  return jsonResponse({ error: "Unknown action" }, 400)
})
