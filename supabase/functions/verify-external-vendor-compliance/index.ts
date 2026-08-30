/**
 * POST verify-external-vendor-compliance (ADMIN_REASSIGN_SECRET).
 * License + COI checks for Find External Vendor verification screen.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
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

  const adminAuth = requireAdminReassignAuth(req, "[verify-external-vendor-compliance]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

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
