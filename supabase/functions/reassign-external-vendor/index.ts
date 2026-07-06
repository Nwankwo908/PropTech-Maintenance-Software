import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import { reassignExternalVendorToTicket } from "../_shared/external_vendor/reassign_external.ts"
import type { ExternalVendorSource } from "../_shared/external_vendor/types.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"

const corsHeaders = adminEdgeCorsHeaders

const SOURCE_SET = new Set<ExternalVendorSource>(["google", "yelp", "netvendor", "mock"])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function parseSources(value: unknown): ExternalVendorSource[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ExternalVendorSource[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const s = item.trim().toLowerCase() as ExternalVendorSource
    if (SOURCE_SET.has(s) && !out.includes(s)) out.push(s)
  }
  return out.length > 0 ? out : undefined
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error("[reassign-external-vendor] ADMIN_REASSIGN_SECRET not set")
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  if (!adminReassignSecretAuthorized(req)) {
    console.warn(
      "[reassign-external-vendor] 401 Unauthorized: x-admin-reassign-secret mismatch",
    )
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: {
    ticketId?: string
    vendorName?: string
    vendorCategory?: string
    sources?: unknown
    rating?: number
    reviewCount?: number
    priceLabel?: string
    rankScore?: number
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  const vendorName = typeof body.vendorName === "string" ? body.vendorName.trim() : ""

  if (!ticketId || !isUuidShape(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
  }
  if (!vendorName) {
    return jsonResponse({ error: "Missing vendorName" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const result = await reassignExternalVendorToTicket(supabase, {
    ticketId,
    vendorName,
    vendorCategory: typeof body.vendorCategory === "string"
      ? body.vendorCategory.trim()
      : null,
    sources: parseSources(body.sources),
    rating: typeof body.rating === "number" && Number.isFinite(body.rating)
      ? body.rating
      : null,
    reviewCount:
      typeof body.reviewCount === "number" && Number.isFinite(body.reviewCount)
        ? body.reviewCount
        : null,
    priceLabel: typeof body.priceLabel === "string" ? body.priceLabel.trim() : null,
    rankScore: typeof body.rankScore === "number" && Number.isFinite(body.rankScore)
      ? body.rankScore
      : null,
  })

  if ("error" in result) {
    return jsonResponse({ error: result.error }, result.status ?? 500)
  }

  return jsonResponse(result)
})
