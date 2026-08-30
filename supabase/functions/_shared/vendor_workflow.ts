import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { resumeMaintenanceWorkflowAfterVendorAccepted } from "./maintenance_admin_escalation.ts"
import { tryAutoReassignAfterDecline } from "./vendor_auto_reassign.ts"
import { beginVendorAvailabilityAsk } from "./vendor_job_schedule.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"

export type VendorSmsReplyAction = "accept" | "decline"

export type VendorStatusTransitionResult =
  | {
      ok: true
      fromStatus: string
      toStatus: string
      action: VendorSmsReplyAction
      /** False when accept ran but "Earliest availability?" SMS did not send. */
      availabilityAskSent?: boolean
    }
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

async function vendorIdsSharePhone(
  supabase: SupabaseClient,
  vendorIdA: string,
  vendorIdB: string,
): Promise<boolean> {
  if (vendorIdA === vendorIdB) return true
  const { data, error } = await supabase
    .from("vendors")
    .select("id, phone")
    .in("id", [vendorIdA, vendorIdB])
  if (error || !data || data.length < 2) return false
  const phones = data
    .map((row) => {
      const raw = typeof row.phone === "string" ? row.phone.trim() : ""
      return normalizePhoneFlexible(raw) ?? raw.replace(/\D/g, "")
    })
    .filter(Boolean)
  return phones.length === 2 && phones[0] === phones[1]
}

/** Assigned-but-unassigned is a broken offer row — treat as waiting for YES. */
export function canVendorSmsAcceptStatus(status: string): boolean {
  const current = status.trim().toLowerCase()
  return current === "pending_accept" || current === "unassigned"
}

export function canVendorSmsDeclineStatus(status: string): boolean {
  const current = status.trim().toLowerCase()
  return (
    current === "pending_accept" ||
    current === "accepted" ||
    current === "unassigned"
  )
}

/**
 * Apply accept/decline to an assigned ticket (shared by email links and SMS replies).
 * On accept: does NOT notify resident — next step is earliest-availability SMS.
 */
export async function applyVendorStatusTransition(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    action: VendorSmsReplyAction
    source: "email_signed" | "sms" | "portal"
    /** When true (default), ask earliest availability over SMS after accept. */
    askAvailability?: boolean
    conversationId?: string | null
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
  const assignedVendorId =
    typeof row.assigned_vendor_id === "string"
      ? row.assigned_vendor_id.trim()
      : ""
  if (!assignedVendorId) {
    return { ok: false, reason: "not_assigned_to_vendor" }
  }
  if (assignedVendorId !== params.vendorId) {
    const shared = await vendorIdsSharePhone(
      supabase,
      assignedVendorId,
      params.vendorId,
    )
    if (!shared) {
      return { ok: false, reason: "not_assigned_to_vendor" }
    }
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
    if (!canVendorSmsAcceptStatus(current)) {
      return { ok: false, reason: "cannot_accept", currentStatus: current }
    }
    next = "accepted"
  } else {
    if (!canVendorSmsDeclineStatus(current)) {
      return { ok: false, reason: "cannot_decline", currentStatus: current }
    }
    next = "declined"
  }

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({ vendor_work_status: next })
    .eq("id", params.ticketId)
    .eq("assigned_vendor_id", assignedVendorId)

  if (upErr) {
    console.error("[vendor-workflow] update status", upErr.message)
    return { ok: false, reason: "update_failed", currentStatus: current }
  }

  const sourceLabel =
    params.source === "sms"
      ? "edge"
      : params.source === "portal"
      ? "portal"
      : params.source

  const { error: logErr } = await supabase.from("vendor_status_events").insert({
    ticket_id: params.ticketId,
    from_status: current,
    to_status: next,
    source: sourceLabel,
    vendor_id: params.vendorId,
  })
  if (logErr) console.error("[vendor-workflow] audit", logErr.message)

  if (next === "accepted") {
    try {
      await resumeMaintenanceWorkflowAfterVendorAccepted(supabase, params.ticketId)
    } catch (e) {
      console.error("[vendor-workflow] resume after accept", e)
    }
  }

  let availabilityAskSent: boolean | undefined
  if (next === "accepted" && params.askAvailability !== false) {
    try {
      const ask = await beginVendorAvailabilityAsk(supabase, {
        ticketId: params.ticketId,
        vendorId: params.vendorId,
        conversationId: params.conversationId ?? null,
      })
      availabilityAskSent = ask.sentSms
    } catch (e) {
      console.error("[vendor-workflow] begin availability ask", e)
      availabilityAskSent = false
    }
  }

  if (next === "declined") {
    try {
      await tryAutoReassignAfterDecline(supabase, params.ticketId, params.vendorId)
    } catch (e) {
      console.error("[vendor-workflow] auto-reassign after decline", e)
    }
  }

  return {
    ok: true,
    fromStatus: current,
    toStatus: next,
    action: params.action,
    availabilityAskSent,
  }
}
