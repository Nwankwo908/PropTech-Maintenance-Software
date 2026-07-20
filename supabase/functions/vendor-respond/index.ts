import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { verifyVendorEmailAction } from "../_shared/vendor_action_token.ts"
import { applyVendorStatusTransition } from "../_shared/vendor_workflow.ts"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"
import { resolveLandlordId } from "../_shared/sms/landlordSmsOnboarding.ts"

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
  const _vendorId = url.searchParams.get("vendorId")?.trim() ?? ""
  const token = url.searchParams.get("token")?.trim() ?? ""

  if (!action || !ticketId || !_vendorId || !token) {
    return htmlResponse(
      "Missing parameters",
      "This link isn't complete. Open the job email we sent you and use the buttons there.",
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
    payload.vendorId !== _vendorId ||
    payload.action !== action
  ) {
    return htmlResponse(
      "Invalid or expired link",
      "This link doesn't work anymore. Ask for a new job email or open your vendor portal.",
      { status: 403 },
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return htmlResponse("Server error", "Misconfiguration.", { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const transition = await applyVendorStatusTransition(supabase, {
    ticketId,
    vendorId: _vendorId,
    action,
    source: "email_signed",
  })

  if (!transition.ok) {
    const msg =
      transition.reason === "not_found"
        ? "This maintenance request was not found."
        : transition.reason === "not_assigned_to_vendor"
          ? "This job is no longer assigned to your company."
          : transition.reason === "already_completed"
            ? "This job is already marked completed."
            : transition.reason === "already_declined"
              ? "This job was already declined."
              : transition.reason === "cannot_accept"
                ? `This job cannot be accepted from its current status (${transition.currentStatus ?? "unknown"}).`
                : transition.reason === "cannot_decline"
                  ? `This job cannot be declined from its current status (${transition.currentStatus ?? "unknown"}).`
                  : "Could not update status."
    const status =
      transition.reason === "not_found"
        ? 404
        : transition.reason === "not_assigned_to_vendor"
          ? 403
          : transition.reason === "already_completed" ||
              transition.reason === "already_declined" ||
              transition.reason === "cannot_accept" ||
              transition.reason === "cannot_decline"
            ? 409
            : 500
    return htmlResponse(
      transition.reason === "not_found" ? "Not found" : "Error",
      msg,
      { status },
    )
  }

  const next = transition.toStatus
  const current = transition.fromStatus

  try {
    await logGraphEvent(supabase, {
      landlord_id: resolveLandlordId(),
      event_type: "vendor.work_status_changed",
      source: "vendor_portal",
      actor_type: "vendor",
      actor_id: _vendorId,
      vendor_id: _vendorId,
      maintenance_request_id: ticketId,
      metadata: {
        action,
        from_status: current,
        to_status: next,
        channel: "email_signed",
      },
    })
  } catch (e) {
    console.error("[vendor-respond] graph event", e)
  }

  console.log(
    JSON.stringify({
      event: "vendor_email_action",
      ticketId,
      _vendorId,
      action,
      from: current,
      to: next,
      at: new Date().toISOString(),
    }),
  )

  const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/$/, "") ?? ""
  const redirectUrl =
    appUrl.length > 0 ? `${appUrl}/vendor/ticket/${ticketId}` : null

  const msg =
    action === "accept"
      ? "You accepted this job. We'll text you to ask for your earliest availability. Taking you to your vendor portal…"
      : "You declined this job. Taking you to your vendor portal…"

  return htmlResponse(action === "accept" ? "Accepted" : "Declined", msg, {
    redirectUrl,
  })
})
