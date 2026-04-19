import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  notifyResidentCompleted,
  notifyResidentInProgress,
} from "../submit-maintenance-request/resident_notify.ts"
import { tryAutoReassignAfterDecline } from "../_shared/vendor_auto_reassign.ts"
import { bearerLooksLikeJwt } from "../_shared/vendor_portal_bearer.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type VendorAction = "accept" | "decline" | "in_progress" | "completed"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function bearerKey(req: Request): string | null {
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return null
  const t = h.slice(7).trim()
  return t || null
}

function nextStatus(
  current: string,
  action: VendorAction,
): { next: string } | { error: string } {
  if (action === "accept") {
    if (current !== "pending_accept") {
      return { error: "accept only allowed from pending_accept" }
    }
    return { next: "accepted" }
  }
  if (action === "decline") {
    const canDecline =
      current === "pending_accept" ||
      current === "accepted" ||
      current === "in_progress"
    if (!canDecline) {
      return {
        error:
          "decline only allowed from pending_accept, accepted, or in_progress",
      }
    }
    return { next: "declined" }
  }
  if (action === "in_progress") {
    if (current !== "pending_accept" && current !== "accepted") {
      return {
        error: "in_progress only allowed from pending_accept or accepted",
      }
    }
    return { next: "in_progress" }
  }
  if (action === "completed") {
    if (current !== "in_progress") {
      return { error: "completed only allowed from in_progress" }
    }
    return { next: "completed" }
  }
  return { error: "invalid action" }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: {
    ticketId?: string
    action?: string
    token?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  const actionRaw = typeof body.action === "string" ? body.action.trim() : ""
  const token =
    typeof body.token === "string" && body.token.trim()
      ? body.token.trim()
      : null

  if (!ticketId || !actionRaw) {
    return jsonResponse({ error: "Missing ticketId or action" }, 400)
  }

  const action = actionRaw as VendorAction
  if (
    action !== "accept" &&
    action !== "decline" &&
    action !== "in_progress" &&
    action !== "completed"
  ) {
    return jsonResponse({ error: "Invalid action" }, 400)
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

  const { data: row, error: rowErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, assigned_vendor_id, vendor_work_status, vendor_action_token",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (rowErr) {
    console.error("[vendor-update-job-status] load ticket", rowErr)
    return jsonResponse({ error: "Load failed" }, 500)
  }
  if (!row) {
    return jsonResponse({ error: "Ticket not found" }, 404)
  }

  if (!row.assigned_vendor_id) {
    return jsonResponse(
      {
        error: "Vendor must be assigned before progressing this job",
        vendor_work_status: row.vendor_work_status,
      },
      422,
    )
  }

  let vendorIdMatched: string | null = null
  let source: "portal" | "email_link" = "portal"

  const accessToken = bearerKey(req)

  if (accessToken) {
    if (bearerLooksLikeJwt(accessToken)) {
      const { data: auth, error: authErr } = await supabase.auth.getUser(accessToken)
      if (authErr || !auth?.user?.id) {
        console.error("[vendor-update-job-status] auth.getUser", authErr)
        return jsonResponse({ error: "Invalid or expired JWT" }, 401)
      }

      const authUid = auth.user.id
      const authEmail =
        typeof auth.user.email === "string" ? auth.user.email.trim().toLowerCase() : null

      const { data: byUid, error: byUidErr } = await supabase
        .from("vendors")
        .select("id, auth_user_id")
        .eq("auth_user_id", authUid)
        .eq("active", true)
        .maybeSingle()

      if (byUidErr) {
        console.error("[vendor-update-job-status] vendor lookup by auth_user_id", byUidErr)
        return jsonResponse({ error: "Lookup failed" }, 500)
      }

      let vendorRow: { id: string; auth_user_id: string | null } | null = byUid ?? null

      if (!vendorRow && authEmail) {
        const { data: byEmail, error: byEmailErr } = await supabase
          .from("vendors")
          .select("id, auth_user_id")
          .ilike("email", authEmail)
          .eq("active", true)
          .maybeSingle()

        if (byEmailErr) {
          console.error("[vendor-update-job-status] vendor lookup by email", byEmailErr)
          return jsonResponse({ error: "Lookup failed" }, 500)
        }

        if (byEmail) {
          if (byEmail.auth_user_id && byEmail.auth_user_id !== authUid) {
            return jsonResponse({ error: "Forbidden" }, 403)
          }
          if (!byEmail.auth_user_id) {
            const { data: linked, error: linkErr } = await supabase
              .from("vendors")
              .update({ auth_user_id: authUid })
              .eq("id", byEmail.id)
              .is("auth_user_id", null)
              .select("id, auth_user_id")
              .maybeSingle()

            if (linkErr) {
              console.error("[vendor-update-job-status] vendor link auth_user_id", linkErr)
              return jsonResponse({ error: "Link failed" }, 500)
            }
            vendorRow = linked ?? byEmail
          } else {
            vendorRow = byEmail
          }
        }
      }

      if (!vendorRow) {
        return jsonResponse({ error: "Vendor not found" }, 403)
      }

      if (vendorRow.id !== row.assigned_vendor_id) {
        return jsonResponse({ error: "Forbidden" }, 403)
      }

      vendorIdMatched = vendorRow.id
    } else if (row.vendor_action_token === accessToken) {
      vendorIdMatched = row.assigned_vendor_id
      source = "email_link"
    } else {
      return jsonResponse({ error: "Invalid Authorization token" }, 401)
    }
  } else if (token && row.vendor_action_token === token) {
    vendorIdMatched = row.assigned_vendor_id
    source = "email_link"
  } else {
    return jsonResponse(
      { error: "Missing valid Authorization bearer or ticket token" },
      401,
    )
  }

  if (!vendorIdMatched || row.assigned_vendor_id !== vendorIdMatched) {
    return jsonResponse({ error: "Forbidden" }, 403)
  }

  const current = row.vendor_work_status as string
  const step = nextStatus(current, action)
  if ("error" in step) {
    return jsonResponse(
      { error: step.error, vendor_work_status: current },
      409,
    )
  }

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({ vendor_work_status: step.next })
    .eq("id", ticketId)
    .eq("assigned_vendor_id", vendorIdMatched)

  if (upErr) {
    console.error("[vendor-update-job-status] update", upErr)
    return jsonResponse({ error: "Update failed" }, 500)
  }

  const { error: logErr } = await supabase.from("vendor_status_events").insert({
    ticket_id: ticketId,
    from_status: current,
    to_status: step.next,
    source,
    vendor_id: vendorIdMatched,
  })
  if (logErr) console.error("[vendor-update-job-status] audit", logErr)

  if (step.next === "declined") {
    try {
      await tryAutoReassignAfterDecline(supabase, ticketId, vendorIdMatched)
    } catch (e) {
      console.error("[vendor-update-job-status] auto-reassign after decline", e)
    }
  }

  if (step.next === "in_progress" || step.next === "completed") {
    const event =
      step.next === "in_progress"
        ? ("repair_in_progress" as const)
        : ("repair_completed" as const)

    const { data: trow } = await supabase
      .from("maintenance_requests")
      .select(
        "resident_name, email, resident_phone, unit, assigned_vendor_id, priority, resident_notification_channel",
      )
      .eq("id", ticketId)
      .maybeSingle()

    let vendorName: string | undefined
    if (trow?.assigned_vendor_id) {
      const { data: v } = await supabase
        .from("vendors")
        .select("name")
        .eq("id", trow.assigned_vendor_id as string)
        .maybeSingle()
      if (v?.name) vendorName = String(v.name)
    }

    if (trow) {
      try {
        const base = {
          ticketId,
          recipientName: String(trow.resident_name ?? ""),
          recipientEmail:
            typeof trow.email === "string" ? trow.email.trim() : "",
          recipientPhone:
            typeof trow.resident_phone === "string"
              ? trow.resident_phone
              : null,
          notificationChannel:
            typeof trow.resident_notification_channel === "string"
              ? trow.resident_notification_channel
              : null,
          unit: typeof trow.unit === "string" ? trow.unit : undefined,
          priority: typeof trow.priority === "string" ? trow.priority : undefined,
          vendorName,
        }
        if (event === "repair_in_progress") {
          await notifyResidentInProgress(supabase, base)
        } else {
          await notifyResidentCompleted(supabase, base)
        }
      } catch (e) {
        console.error("[vendor-update-job-status] resident notify", e)
      }
    }
  }

  return jsonResponse({
    ok: true,
    ticketId,
    vendor_work_status: step.next,
  })
})
