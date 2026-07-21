import { serve } from "https://deno.land/std/http/server.ts"
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { bearerLooksLikeJwt } from "../_shared/vendor_portal_bearer.ts"
import { getVendorFromPortalApiKey } from "../_shared/vendor_portal_api_key.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function failReason(reason: string) {
  console.log("[vendor-list-tickets] FAIL reason:", reason)
}

function bearerKey(req: Request): string | null {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
}

const SIGNED_URL_TTL_SEC = 3600

/** Signed GET URLs for `maintenance-uploads` paths (private bucket). */
async function photoSignedUrls(
  supabase: SupabaseClient,
  paths: unknown,
): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0) return []
  const urls: string[] = []
  for (const p of paths) {
    if (typeof p !== "string" || !p.trim()) continue
    const { data, error } = await supabase.storage
      .from("maintenance-uploads")
      .createSignedUrl(p.trim(), SIGNED_URL_TTL_SEC)
    if (error) {
      console.error("[vendor-list-tickets] signed url", p, error)
      continue
    }
    if (data?.signedUrl) urls.push(data.signedUrl)
  }
  return urls
}

serve(async (req) => {
  console.log("SUPABASE CLIENT TYPE:", !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const accessToken = bearerKey(req)
  if (!accessToken) {
    return jsonResponse({ error: "Missing Authorization: Bearer <access_token>" }, 401)
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

  let vendor: { id: string; name: string } | null = null

  if (bearerLooksLikeJwt(accessToken)) {
    const { data: auth, error: authErr } = await supabase.auth.getUser(accessToken)
    if (authErr || !auth?.user?.id) {
      console.error("[vendor-list-tickets] auth.getUser", authErr)
      return jsonResponse({ error: "Invalid or expired JWT" }, 401)
    }

    const authUid = auth.user.id
    const authEmail =
      typeof auth.user.email === "string" ? auth.user.email.trim().toLowerCase() : null

    let jwtVendor: { id: string; name: string; auth_user_id: string | null } | null = null

    const { data: byUid, error: byUidErr } = await supabase
      .from("vendors")
      .select("id, name, auth_user_id")
      .eq("auth_user_id", authUid)
      .eq("active", true)
      .maybeSingle()

    if (byUidErr) {
      console.error("[vendor-list-tickets] vendor lookup by auth_user_id", byUidErr)
      return jsonResponse({ error: "Lookup failed" }, 500)
    }
    if (byUid) {
      jwtVendor = byUid
    } else if (authEmail) {
      const { data: byEmail, error: byEmailErr } = await supabase
        .from("vendors")
        .select("id, name, auth_user_id")
        .ilike("email", authEmail)
        .eq("active", true)
        .maybeSingle()

      if (byEmailErr) {
        console.error("[vendor-list-tickets] vendor lookup by email", byEmailErr)
        return jsonResponse({ error: "Lookup failed" }, 500)
      }

      if (byEmail) {
        if (byEmail.auth_user_id && byEmail.auth_user_id !== authUid) {
          failReason("jwt email vendor mismatch")
          return jsonResponse({ error: "Forbidden" }, 403)
        }
        if (!byEmail.auth_user_id) {
          const { data: linked, error: linkErr } = await supabase
            .from("vendors")
            .update({ auth_user_id: authUid })
            .eq("id", byEmail.id)
            .is("auth_user_id", null)
            .select("id, name, auth_user_id")
            .maybeSingle()

          if (linkErr) {
            console.error("[vendor-list-tickets] vendor link auth_user_id", linkErr)
            return jsonResponse({ error: "Link failed" }, 500)
          }
          jwtVendor = linked ?? byEmail
        } else {
          jwtVendor = byEmail
        }
      }
    }

    if (!jwtVendor) {
      failReason("jwt vendor not found")
      return jsonResponse({ error: "Vendor not found" }, 403)
    }
    vendor = { id: jwtVendor.id, name: jwtVendor.name }
  } else {
    const portalVendor = await getVendorFromPortalApiKey(supabase, accessToken)
    if (!portalVendor) {
      return jsonResponse({ error: "Invalid or unknown vendor portal token" }, 401)
    }
    vendor = portalVendor
  }

  if (!vendor) {
    failReason("vendor unresolved after auth branches")
    return jsonResponse({ error: "Vendor not found" }, 403)
  }

  const { data: rows, error: qErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, created_at, priority, urgency, resident_name, unit, description, photo_paths, completion_photo_paths, vendor_work_status, assigned_vendor_id, due_at, estimated_minutes, severity, issue_category, vendor_action_token",
    )
    .eq("assigned_vendor_id", vendor.id)
    .order("created_at", { ascending: false })

  if (qErr) {
    console.error("[vendor-list-tickets] query", qErr)
    return jsonResponse({ error: "Query failed" }, 500)
  }

  const ticketIds = (rows ?? []).map((r) => r.id as string).filter(Boolean)

  const buildingById = new Map<string, string>()
  const approvedEstimateById = new Map<
    string,
    {
      parts_cost: number
      labor_cost: number
      total_cost: number
      status: string
      approved_at: string | null
    }
  >()
  const awaitingFeedbackIds = new Set<string>()

  if (ticketIds.length > 0) {
    const { data: enrichedRows } = await supabase
      .from("maintenance_request_enriched")
      .select("id, building")
      .in("id", ticketIds)
    for (const e of enrichedRows ?? []) {
      if (
        typeof e.id === "string" &&
        typeof e.building === "string" &&
        e.building.trim()
      ) {
        buildingById.set(e.id, e.building.trim())
      }
    }

    const { data: estimateRows } = await supabase
      .from("maintenance_estimates")
      .select(
        "maintenance_request_id, parts_cost, labor_cost, total_cost, status, decided_at, created_at",
      )
      .in("maintenance_request_id", ticketIds)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
    for (const est of estimateRows ?? []) {
      const tid =
        typeof est.maintenance_request_id === "string"
          ? est.maintenance_request_id
          : ""
      if (!tid || approvedEstimateById.has(tid)) continue
      approvedEstimateById.set(tid, {
        parts_cost: Number(est.parts_cost) || 0,
        labor_cost: Number(est.labor_cost) || 0,
        total_cost: Number(est.total_cost) || 0,
        status: "approved",
        approved_at:
          typeof est.decided_at === "string"
            ? est.decided_at
            : typeof est.created_at === "string"
            ? est.created_at
            : null,
      })
    }

    const { data: feedbackRows } = await supabase
      .from("vendor_feedback_requests")
      .select("maintenance_request_id")
      .in("maintenance_request_id", ticketIds)
      .eq("rater_type", "resident")
      .eq("status", "open")
    for (const f of feedbackRows ?? []) {
      if (typeof f.maintenance_request_id === "string") {
        awaitingFeedbackIds.add(f.maintenance_request_id)
      }
    }
  }

  const tickets = await Promise.all(
    (rows ?? []).map(async (row) => {
      const id = row.id as string
      const photo_urls = await photoSignedUrls(supabase, row.photo_paths)
      const completion_photo_urls = await photoSignedUrls(
        supabase,
        row.completion_photo_paths,
      )
      const completionPaths = Array.isArray(row.completion_photo_paths)
        ? (row.completion_photo_paths as string[]).filter(
          (p) => typeof p === "string" && p.trim(),
        )
        : []
      const building = buildingById.get(id) ?? null
      const unitLabel =
        typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : ""
      const building_address = building
        ? unitLabel
          ? `${building}`
          : building
        : unitLabel || null
      return {
        ...row,
        building: building,
        building_address,
        photo_urls,
        completion_photo_urls,
        completion_photo_count: Math.max(
          completionPaths.length,
          completion_photo_urls.length,
        ),
        approved_estimate: approvedEstimateById.get(id) ?? null,
        awaiting_resident_feedback: awaitingFeedbackIds.has(id),
      }
    }),
  )

  const data = { vendor: { id: vendor.id, name: vendor.name }, tickets }
  console.log("[vendor-list-tickets] SUCCESS returning data")
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
