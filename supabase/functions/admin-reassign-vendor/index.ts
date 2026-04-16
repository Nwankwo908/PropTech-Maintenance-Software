import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { reassignVendorByIdAndNotify } from "../submit-maintenance-request/vendor_notify.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function bearerAdminSecret(req: Request): string | null {
  const expected = Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()
  if (!expected) return null
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t === expected ? t : null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error("[admin-reassign-vendor] ADMIN_REASSIGN_SECRET not set")
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  if (!bearerAdminSecret(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: {
    ticketId?: string
    vendorId?: string
    vendorName?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  const vendorIdRaw =
    typeof body.vendorId === "string" ? body.vendorId.trim() : ""
  const vendorName =
    typeof body.vendorName === "string" ? body.vendorName.trim() : ""

  if (!ticketId || !uuidRe.test(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
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

  let vendorId = ""
  if (vendorIdRaw && uuidRe.test(vendorIdRaw)) {
    vendorId = vendorIdRaw
  } else if (vendorName) {
    const needle = vendorName
      .trim()
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
    const { data: rows, error: exErr } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("active", true)
      .ilike("name", needle)
      .limit(25)

    if (exErr) {
      console.error("[admin-reassign-vendor] vendor by name", exErr)
      return jsonResponse({ error: "Vendor lookup failed" }, 500)
    }
    const norm = (s: string) => s.trim().toLowerCase()
    const want = norm(vendorName)
    const matches = (rows ?? []).filter((r) => norm(r.name as string) === want)
    if (matches.length === 0) {
      return jsonResponse(
        { error: `No active vendor found named "${vendorName}"` },
        404,
      )
    }
    if (matches.length > 1) {
      return jsonResponse(
        {
          error:
            "Multiple vendors match that name; use vendorId (uuid) instead",
        },
        409,
      )
    }
    vendorId = matches[0].id as string
  } else {
    return jsonResponse(
      { error: "Provide vendorId (uuid) or vendorName" },
      400,
    )
  }

  const result = await reassignVendorByIdAndNotify(supabase, ticketId, vendorId)
  // Plan: resident `vendor_assigned` email/SMS is sent inside reassignVendorByIdAndNotify (notifyResidentVendorAssigned).
  if ("error" in result) {
    const status =
      result.error === "Ticket not found"
        ? 404
        : result.error.includes("Vendor not")
          ? 404
          : 500
    return jsonResponse({ error: result.error }, status)
  }

  return jsonResponse({ ok: true, ticketId, assigned_vendor_id: vendorId })
})
