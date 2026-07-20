/**
 * Landlord 1-tap vendor star rating after job completion (Phase 4 / 4.4).
 * GET ?rating=1-5&ticketId=&token=
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { submitLandlordVendorRating } from "../_shared/maintenanceCompletion.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function htmlResponse(
  title: string,
  message: string,
  status = 200,
): Response {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5;color:#101828;max-width:32rem;margin:0 auto;">
  <h1 style="font-size:1.25rem;margin:0 0 12px;">${escapeHtml(title)}</h1>
  <p style="margin:0;color:#364153;">${escapeHtml(message)}</p>
</body>
</html>`
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  })
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "GET") {
    return htmlResponse("Method not allowed", "Use the link from your text or email.", 405)
  }

  const url = new URL(req.url)
  const ratingRaw = (url.searchParams.get("rating") ?? "").trim()
  const rating = Number(ratingRaw)
  const ticketId = (url.searchParams.get("ticketId") ?? "").trim()
  const token = (url.searchParams.get("token") ?? "").trim()

  if (
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    !uuidRe.test(ticketId) ||
    !uuidRe.test(token)
  ) {
    return htmlResponse(
      "Invalid link",
      "This rating link is missing information. Use the links from your completion text.",
      400,
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return htmlResponse("Server error", "Misconfiguration.", 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await submitLandlordVendorRating(supabase, {
    ticketId,
    jobToken: token,
    rating,
  })

  if (!result.ok) {
    return htmlResponse("Could not save rating", result.error, result.status ?? 400)
  }

  return htmlResponse("Thanks", result.message)
})
