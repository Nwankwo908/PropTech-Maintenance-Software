import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { tryAutoReassignAfterDecline } from "./vendor_auto_reassign.ts"
import { notifyResidentVendorAccepted } from "../submit-maintenance-request/resident_notify.ts"

export type VendorSmsReplyAction = "accept" | "decline"

export type VendorStatusTransitionResult =
  | { ok: true; fromStatus: string; toStatus: string; action: VendorSmsReplyAction }
  | { ok: false; reason: string; currentStatus?: string }

/** Parse vendor SMS for accept/decline intent. */
export function parseVendorSmsReply(body: string): VendorSmsReplyAction | null {
  const normalized = body.trim().toLowerCase().replace(/\s+/g, " ")
  if (!normalized) return null

  if (
    /^(accept|accepted|yes|y|ok|okay|confirm|confirmed|approve|approved)(\b|$)/.test(
      normalized,
    ) ||
    /\baccept\b/.test(normalized)
  ) {
    return "accept"
  }

  if (
    /^(decline|declined|no|n|reject|rejected|pass|cancel|cancelled)(\b|$)/.test(
      normalized,
    ) ||
    /\bdecline\b/.test(normalized)
  ) {
    return "decline"
  }

  return null
}

/** Apply accept/decline to an assigned ticket (shared by email links and SMS replies). */
export async function applyVendorStatusTransition(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    action: VendorSmsReplyAction
    source: "email_signed" | "sms"
  },
): Promise<VendorStatusTransitionResult> {
  const { data: row, error: rowErr } = await supabase
    .from("maintenance_requests")
    .select("id, assigned_vendor_id, vendor_work_status")
    .eq("id", params.ticketId)
    .maybeSingle()

  if (rowErr) {
    console.error("[vendor-workflow] load ticket", rowErr.message)
    return { ok: false, reason: "load_failed" }
  }
  if (!row) {
    return { ok: false, reason: "not_found" }
  }
  if (row.assigned_vendor_id !== params.vendorId) {
    return { ok: false, reason: "not_assigned_to_vendor" }
  }

  const current = String(row.vendor_work_status ?? "")

  if (current === "completed") {
    return { ok: false, reason: "already_completed", currentStatus: current }
  }
  if (current === "declined" && params.action === "decline") {
    return { ok: false, reason: "already_declined", currentStatus: current }
  }

  let next: string
  if (params.action === "accept") {
    if (current !== "pending_accept") {
      return { ok: false, reason: "cannot_accept", currentStatus: current }
    }
    next = "accepted"
  } else {
    if (current !== "pending_accept" && current !== "accepted") {
      return { ok: false, reason: "cannot_decline", currentStatus: current }
    }
    next = "declined"
  }

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({ vendor_work_status: next })
    .eq("id", params.ticketId)
    .eq("assigned_vendor_id", params.vendorId)

  if (upErr) {
    console.error("[vendor-workflow] update status", upErr.message)
    return { ok: false, reason: "update_failed", currentStatus: current }
  }

  const { error: logErr } = await supabase.from("vendor_status_events").insert({
    ticket_id: params.ticketId,
    from_status: current,
    to_status: next,
    source: params.source === "sms" ? "edge" : params.source,
    vendor_id: params.vendorId,
  })
  if (logErr) console.error("[vendor-workflow] audit", logErr.message)

  if (next === "accepted") {
    try {
      const { data: trow } = await supabase
        .from("maintenance_requests")
        .select(
          "resident_name, email, resident_phone, unit, assigned_vendor_id, priority, resident_notification_channel",
        )
        .eq("id", params.ticketId)
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
        await notifyResidentVendorAccepted(supabase, {
          ticketId: params.ticketId,
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
        })
      }
    } catch (e) {
      console.error("[vendor-workflow] resident notify vendor_accepted", e)
    }
  }

  if (next === "declined") {
    try {
      await tryAutoReassignAfterDecline(supabase, params.ticketId, params.vendorId)
    } catch (e) {
      console.error("[vendor-workflow] auto-reassign after decline", e)
    }
  }

  return { ok: true, fromStatus: current, toStatus: next, action: params.action }
}
