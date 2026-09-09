/// <reference lib="deno.ns" />
/**
 * Refresh the Home Data Graph from the active adapter (HOME_DATA_PROVIDER).
 * The dashboard reads home_data_graph only — never vendor APIs.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import {
  homeDataHasFacts,
  homeDataNeedsProviderRefresh,
  type HomeDataGraphSnapshot,
} from "../../../shared/homeDataGraph.ts"
import {
  fetchHomeDataFromProvider,
  resolveHomeDataProvider,
} from "../_shared/homeDataGraph/providers.ts"
import {
  loadHomeDataGraphSnapshot,
  persistHomeDataGraph,
} from "../_shared/homeDataGraph/persist.ts"

const corsHeaders = adminEdgeCorsHeaders

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

  const adminAuth = requireAdminReassignAuth(req, "[sync-home-data-graph]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: {
    propertyId?: string
    landlordId?: string
    address?: string
    force?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const propertyId = typeof body.propertyId === "string" ? body.propertyId.trim() : ""
  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  const address = typeof body.address === "string" ? body.address.trim() : ""
  const force = body.force === true
  if (!propertyId || !landlordId) {
    return jsonResponse({ error: "Missing propertyId or landlordId" }, 400)
  }
  if (!address) {
    return jsonResponse({ error: "Missing address" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const existing = await loadHomeDataGraphSnapshot(supabase, propertyId)
  if (existing && !force && !homeDataNeedsProviderRefresh(existing)) {
    return jsonResponse({ snapshot: existing, refreshed: false, configured: true })
  }

  const provider = resolveHomeDataProvider()
  try {
    const fetched = await fetchHomeDataFromProvider({ provider, address })
    if (fetched.status === "unsupported") {
      return jsonResponse(
        {
          snapshot: existing,
          refreshed: false,
          configured: false,
          lookupError: fetched.error,
        },
        provider === "attom" ? 501 : 200,
      )
    }
    if (fetched.status === "not_configured") {
      return jsonResponse({
        snapshot: existing,
        refreshed: false,
        configured: false,
        lookupError: fetched.error,
      })
    }

    if (!homeDataHasFacts(fetched.ingest.facts)) {
      return jsonResponse({
        snapshot: existing,
        refreshed: false,
        configured: true,
        lookupError: `No property data found for “${address}”. Check the street, city, and ZIP.`,
      })
    }

    const saved = await persistHomeDataGraph(supabase, {
      landlordId,
      propertyId,
      ingest: fetched.ingest,
    })
    if (!saved.ok) {
      return jsonResponse({ error: saved.error }, 502)
    }
    return jsonResponse({
      snapshot: saved.snapshot satisfies HomeDataGraphSnapshot,
      refreshed: true,
      configured: true,
      lookupError: null,
    })
  } catch (err) {
    console.error("[sync-home-data-graph]", err)
    return jsonResponse({ error: "Could not load property data" }, 502)
  }
})
