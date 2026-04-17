import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { verifyVendorEmailAction } from "../_shared/vendor_action_token.ts"
import { tryAutoReassignAfterDecline } from "../_shared/vendor_auto_reassign.ts"

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
  opts: { status?: number; redirectUrl?: string | null },
): Response {
  const status = opts.status ?? 200
  const redirect = opts.redirectUrl
  const meta = redirect
    ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(redirect)}"/>`
    : ""
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  ${meta}
</head>
<body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5;color:#101828;">
  <p>${message}</p>
  ${
    redirect
      ? `<p><a href="${escapeHtml(redirect)}">Open vendor portal</a></p>`
      : ""
  }
</body>
</html>`
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "GET") {
    return htmlResponse("Not allowed", "Only GET is supported for email links.", {
      status: 405,
    })
  }

  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return htmlResponse("Bad request", "Invalid URL.", { status: 400 })
  }

  const action = url.searchParams.get("action")?.trim().toLowerCase()
  const ticketId = url.searchParams.get("ticketId")?.trim() ?? ""
  const vendorId = url.searchParams.get("vendorId")?.trim() ?? ""
  const token = url.searchParams.get("token")?.trim() ?? ""

  if (!action || !ticketId || !vendorId || !token) {
    return htmlResponse(
      "Missing parameters",
      "This link is incomplete. Open your vendor email and use the buttons there.",
      { status: 400 },
    )
  }

  if (action !== "accept" && action !== "decline") {
    return htmlResponse("Invalid action", "Unknown action.", { status: 400 })
  }

  const secret = Deno.env.get("VENDOR_EMAIL_ACTION_SECRET")?.trim()
  if (!secret) {
    console.error("[vendor-respond] missing VENDOR_EMAIL_ACTION_SECRET")
    return htmlResponse(
      "Configuration error",
      "Email actions are not configured. Contact support.",
      { status: 500 },
    )
  }

  const payload = await verifyVendorEmailAction(secret, token)
  if (
    !payload ||
    payload.ticketId !== ticketId ||
    payload.vendorId !== vendorId ||
    payload.action !== action
  ) {
    return htmlResponse(
      "Invalid or expired link",
      "This link is invalid or has expired. Request a new assignment email or open the vendor portal.",
      { status: 403 },
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return htmlResponse("Server error", "Misconfiguration.", { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: row, error: rowErr } = await supabase
    .from("maintenance_requests")
    .select("id, assigned_vendor_id, vendor_work_status, vendor_action_token")
    .eq("id", ticketId)
    .maybeSingle()

  if (rowErr) {
    console.error("[vendor-respond] load ticket", rowErr)
    return htmlResponse("Error", "Could not load this job.", { status: 500 })
  }
  if (!row) {
    return htmlResponse("Not found", "This maintenance request was not found.", {
      status: 404,
    })
  }

  if (row.assigned_vendor_id !== vendorId) {
    return htmlResponse(
      "Not assigned",
      "This job is no longer assigned to your company.",
      { status: 403 },
    )
  }

  const current = row.vendor_work_status as string

  if (current === "completed") {
    return htmlResponse(
      "Already completed",
      "This job is already marked completed.",
      { status: 409 },
    )
  }

  if (current === "declined") {
    return htmlResponse(
      "Already declined",
      "This job was already declined.",
      { status: 409 },
    )
  }

  let next: string
  if (action === "accept") {
    if (current !== "pending_accept") {
      return htmlResponse(
        "Cannot accept",
        `This job cannot be accepted from its current status (${current}).`,
        { status: 409 },
      )
    }
    next = "accepted"
  } else {
    if (current !== "pending_accept" && current !== "accepted") {
      return htmlResponse(
        "Cannot decline",
        `This job cannot be declined from its current status (${current}).`,
        { status: 409 },
      )
    }
    next = "declined"
  }

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({ vendor_work_status: next })
    .eq("id", ticketId)
    .eq("assigned_vendor_id", vendorId)

  if (upErr) {
    console.error("[vendor-respond] update", upErr)
    return htmlResponse("Error", "Could not update status.", { status: 500 })
  }

  const { error: logErr } = await supabase.from("vendor_status_events").insert({
    ticket_id: ticketId,
    from_status: current,
    to_status: next,
    source: "email_signed",
    vendor_id: vendorId,
  })
  if (logErr) console.error("[vendor-respond] audit", logErr)

  console.log(
    JSON.stringify({
      event: "vendor_email_action",
      ticketId,
      vendorId,
      action,
      from: current,
      to: next,
      at: new Date().toISOString(),
    }),
  )

  if (next === "declined") {
    try {
      await tryAutoReassignAfterDecline(supabase, ticketId, vendorId)
    } catch (e) {
      console.error("[vendor-respond] auto-reassign after decline", e)
    }
  }

  const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/$/, "") ?? ""
  const keyParam = row.vendor_action_token
    ? `?k=${encodeURIComponent(row.vendor_action_token)}`
    : ""
  const redirectUrl =
    appUrl.length > 0 ? `${appUrl}/vendor/ticket/${ticketId}${keyParam}` : null

  const msg =
    action === "accept"
      ? "You accepted this job. Redirecting to your vendor portal…"
      : "You declined this job. Redirecting to your vendor portal…"

  return htmlResponse(action === "accept" ? "Accepted" : "Declined", msg, {
    redirectUrl,
  })
})
